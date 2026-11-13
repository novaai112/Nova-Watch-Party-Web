"""Age estimators. Each returns one estimated age (years) per face found in a BGR image."""
import os


class NoFace(Exception):
    pass


class MockEstimator:
    """Fixed answer for testing the HTTP contract. Refuses to start unless ESTIMATOR=mock."""
    name = "mock"

    def __init__(self):
        self.age = float(os.environ.get("MOCK_AGE", "30"))
        self.faces = int(os.environ.get("MOCK_FACES", "1"))

    def warmup(self):
        pass

    def estimate(self, image_bytes):
        return [self.age] * self.faces


class DeepFaceEstimator:
    """Local deep-learning age model (DeepFace 'Age', VGG-Face based). Runs fully on this machine.
    First start downloads the model weights once (several hundred MB) into ~/.deepface/weights."""
    name = "deepface"

    def __init__(self):
        self.detector = os.environ.get("DETECTOR", "opencv")
        self._df = None

    def _lib(self):
        if self._df is None:
            from deepface import DeepFace  # imported lazily: slow (loads TensorFlow)
            self._df = DeepFace
        return self._df

    def warmup(self):
        import numpy as np
        df = self._lib()
        blank = np.full((224, 224, 3), 127, dtype="uint8")
        df.analyze(img_path=blank, actions=["age"], enforce_detection=False,
                   detector_backend=self.detector, silent=True)

    def estimate(self, image_bytes):
        import cv2
        import numpy as np
        img = cv2.imdecode(np.frombuffer(image_bytes, dtype="uint8"), cv2.IMREAD_COLOR)
        if img is None:
            raise NoFace("undecodable image")
        h, w = img.shape[:2]
        if min(h, w) < 160:
            raise NoFace("image too small")
        try:
            res = self._lib().analyze(img_path=img, actions=["age"], enforce_detection=True,
                                      detector_backend=self.detector, silent=True)
        except ValueError as e:                      # DeepFace raises ValueError when no face is found
            raise NoFace(str(e))
        if isinstance(res, dict):
            res = [res]
        # ignore tiny background detections (< 8 % of the frame width) so a poster far behind doesn't count
        faces = [r for r in res if (r.get("region") or {}).get("w", w) >= 0.08 * w]
        if not faces:
            raise NoFace("no usable face")
        return [float(r["age"]) for r in faces]


def make():
    kind = os.environ.get("ESTIMATOR", "deepface").lower()
    if kind == "mock":
        return MockEstimator()
    if kind == "deepface":
        return DeepFaceEstimator()
    raise SystemExit("ESTIMATOR must be 'deepface' or 'mock'")
