import { defineConfig } from 'vite';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const PROJECT_ROOT = resolve(import.meta.dirname, '..');
const BLENDER = process.env.BLENDER_PATH ?? '/Applications/Blender.app/Contents/MacOS/Blender';

/**
 * Пересборка библиотеки пропов по кнопке из игры.
 *
 * Запускает Blender без интерфейса на сохранённом Env.blend и прогоняет
 * tools/export_props.py — тот же скрипт, что и вручную. Только для dev-сервера.
 */
function blenderExport() {
  return {
    name: 'blender-export',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/rebuild-props', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('POST');
          return;
        }

        const started = Date.now();
        const blender = spawn(BLENDER, [
          '-b', resolve(PROJECT_ROOT, 'Env.blend'),
          '--python', resolve(import.meta.dirname, 'tools/export_props.py'),
        ]);

        let output = '';
        blender.stdout.on('data', (chunk) => { output += chunk; });
        blender.stderr.on('data', (chunk) => { output += chunk; });

        blender.on('error', (error) => {
          res.statusCode = 500;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: `не удалось запустить Blender: ${error.message}` }));
        });

        blender.on('close', (code) => {
          // из всего вывода Blender нам интересны только строки самого скрипта
          const lines = output
            .split('\n')
            .filter((line) => /поднято|возвращена|удалена|props\.glb|! /.test(line))
            .map((line) => line.trim());

          res.statusCode = code === 0 ? 200 : 500;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({
            ok: code === 0,
            seconds: ((Date.now() - started) / 1000).toFixed(1),
            lines,
            output: code === 0 ? undefined : output.slice(-2000),
          }));
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [blenderExport()],
  server: {
    port: 5173,
    open: false,
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
});
