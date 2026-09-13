/**
 * Панель разработчика: кнопка пересборки ресурсов.
 *
 * Модели уезжают из .blend через Blender, музыка и заставки просто копируются
 * из соседних папок проекта в public — туда, откуда их берёт игра.
 *
 * Нажатие запускает на dev-сервере Blender без интерфейса с тем же скриптом
 * экспорта, что и вручную, а затем подхватывает свежий props.glb и заново
 * собирает текущую локацию — без перезагрузки страницы.
 *
 * Blender читает файл с диска, поэтому изменения нужно сначала сохранить (Cmd+S).
 */
export function createRebuildPanel({ onRebuilt }) {
  const panel = document.createElement('div');
  panel.className = 'devpanel';

  const button = document.createElement('button');
  button.className = 'devpanel__button';
  button.textContent = 'Обновить';

  const status = document.createElement('div');
  status.className = 'devpanel__status';

  panel.append(button, status);
  document.body.appendChild(panel);

  const setStatus = (text, kind = '') => {
    status.textContent = text;
    status.dataset.kind = kind;
  };

  button.addEventListener('click', async () => {
    button.disabled = true;
    setStatus('Blender собирает модели…', 'busy');

    try {
      const response = await fetch('/api/rebuild-props', { method: 'POST' });
      const result = await response.json();

      if (!result.ok) {
        setStatus(result.error ?? 'сборка не удалась, подробности в терминале', 'fail');
        console.error('[rebuild]', result.output ?? result.error);
        return;
      }

      setStatus('загружаю в сцену…', 'busy');
      const summary = await onRebuilt();

      setStatus(`готово за ${result.seconds} с · ${summary}`, 'ok');
      console.log('[rebuild]\n' + result.lines.join('\n'));
    } catch (error) {
      setStatus('сервер не ответил', 'fail');
      console.error('[rebuild]', error);
    } finally {
      button.disabled = false;
    }
  });

  return panel;
}
