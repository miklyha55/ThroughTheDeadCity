/**
 * Тач ли это устройство. Смотрим на возможности указателя, а не на userAgent:
 * coarse-указатель без наведения — это палец, каким бы ни был браузер.
 * Режим принудительно переключается через ?ui=touch и ?ui=desktop — для проверки с десктопа.
 */
export function isTouchDevice() {
  const forced = new URLSearchParams(location.search).get('ui');
  if (forced === 'touch') return true;
  if (forced === 'desktop') return false;

  const coarse = matchMedia('(pointer: coarse)').matches;
  const noHover = matchMedia('(hover: none)').matches;
  return (coarse || noHover) && navigator.maxTouchPoints > 0;
}
