(() => {
  'use strict';

  if (!matchMedia('(max-width: 899px)').matches) return;

  const peopleTabs = ['friends', 'recents', 'requests', 'blocked'];
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

  document.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' || event.isPrimary === false) return;
    const target = elementTarget(event.target);
    if (!target || !target.closest || target.closest('input, textarea, select, [contenteditable="true"], video, iframe, [data-no-swipe]')) return;
    start = { x: event.clientX, y: event.clientY, target, pointerId: event.pointerId, clickTarget: actionableTarget(target) };
  }, { passive: true });

  document.addEventListener('pointerup', event => {
    if (!start || (start.pointerId !== undefined && start.pointerId !== event.pointerId)) return;
    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    const target = start.target;
    const clickTarget = start.clickTarget;
    start = null;
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
  }, { passive: true });

  document.addEventListener('pointercancel', () => { start = null; }, { passive: true });
})();
