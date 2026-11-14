(() => {
  'use strict';

  if (!matchMedia('(max-width: 899px)').matches) return;

  const peopleTabs = ['chats', 'friends', 'requests', 'blocked'];
  let start = null;
  let clickSuppressionTarget = null;
  let clickSuppressionTimer = null;

  const elementTarget = target => target && (target.nodeType === 1 ? target : target.parentElement);
  const actionableTarget = target => target.closest('button, a, [role="button"]');
  const suppressClick = target => {
    if (!target) return;
    clickSuppressionTarget = target;
    clearTimeout(clickSuppressionTimer);
    clickSuppressionTimer = setTimeout(() => { clickSuppressionTarget = null; }, 500);
  };
  const canStart = target => target && target.closest &&
    !target.closest('input, textarea, select, [contenteditable="true"], video, iframe, [data-no-swipe]');

  function finishSwipe(target, deltaX, deltaY, clickTarget) {
    if (Math.abs(deltaX) < 70 || Math.abs(deltaX) < Math.abs(deltaY) * 1.3) return;

    if (target.closest('#home') && !document.getElementById('rm') &&
        document.getElementById('scr')?.hidden !== false &&
        document.getElementById('fr')?.hidden !== false) {
      suppressClick(clickTarget);
      location.href = deltaX < 0 ? 'profile.html#settings' : 'profile.html#friends';
      return;
    }

    if (!target.closest('#app') || !document.body.classList.contains('people-experience-active') ||
        document.body.classList.contains('message-chat-active')) return;
    const selected = document.querySelector('[data-people-tab].on');
    const current = peopleTabs.indexOf(selected && selected.dataset.peopleTab);
    if (current < 0) return;
    const next = current + (deltaX < 0 ? 1 : -1);
    if (next < 0 || next >= peopleTabs.length) return;
    const button = document.querySelector(`[data-people-tab="${peopleTabs[next]}"]`);
    if (button) {
      button.click();
      suppressClick(clickTarget);
    }
  }

  document.addEventListener('click', event => {
    if (!clickSuppressionTarget) return;
    const target = elementTarget(event.target);
    if (!target || !(target === clickSuppressionTarget ||
        clickSuppressionTarget.contains(target) || target.contains(clickSuppressionTarget))) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    clickSuppressionTarget = null;
    clearTimeout(clickSuppressionTimer);
  }, true);

  if (typeof window !== 'undefined' && 'ontouchstart' in window) {
    document.addEventListener('touchstart', event => {
      start = null;
      if (event.touches.length !== 1) return;
      const touch = event.changedTouches[0];
      const target = elementTarget(event.target);
      if (!canStart(target)) return;
      start = { x: touch.clientX, y: touch.clientY, target, identifier: touch.identifier, clickTarget: actionableTarget(target) };
    }, { passive: true });

    document.addEventListener('touchmove', event => {
      if (!start) return;
      if (event.touches.length !== 1) { start = null; return; }
      let touch = null;
      for (let i = 0; i < event.touches.length; i++) {
        if (event.touches[i].identifier === start.identifier) { touch = event.touches[i]; break; }
      }
      if (!touch) return;
      const deltaX = touch.clientX - start.x;
      const deltaY = touch.clientY - start.y;
      if (Math.abs(deltaX) > 10 && Math.abs(deltaX) > Math.abs(deltaY) * 1.1) event.preventDefault();
    }, { passive: false });

    document.addEventListener('touchend', event => {
      if (!start) return;
      let touch = null;
      for (let i = 0; i < event.changedTouches.length; i++) {
        if (event.changedTouches[i].identifier === start.identifier) { touch = event.changedTouches[i]; break; }
      }
      if (!touch) return;
      const current = start;
      start = null;
      finishSwipe(current.target, touch.clientX - current.x, touch.clientY - current.y, current.clickTarget);
    }, { passive: true });

    document.addEventListener('touchcancel', () => { start = null; }, { passive: true });
  } else {
    document.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse' || event.isPrimary === false) return;
      const target = elementTarget(event.target);
      if (!canStart(target)) return;
      start = { x: event.clientX, y: event.clientY, target, pointerId: event.pointerId, clickTarget: actionableTarget(target) };
    }, { passive: true });

    document.addEventListener('pointerup', event => {
      if (!start || (start.pointerId !== undefined && start.pointerId !== event.pointerId)) return;
      const current = start;
      start = null;
      finishSwipe(current.target, event.clientX - current.x, event.clientY - current.y, current.clickTarget);
    }, { passive: true });

    document.addEventListener('pointercancel', () => { start = null; }, { passive: true });
  }
})();
