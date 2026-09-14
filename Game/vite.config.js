import { defineConfig } from 'vite';
import { spawn } from 'node:child_process';
import { basename, resolve } from 'node:path';
import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const PROJECT_ROOT = resolve(import.meta.dirname, '..');
const BLENDER = process.env.BLENDER_PATH ?? '/Applications/Blender.app/Contents/MacOS/Blender';

/**
 * Что пересобирает кнопка «Обновить модели»: каждый .blend проекта своим скриптом.
 * Порядок неважен, файлы независимы.
 */
/**
 * Что просто копируется как есть: звук и заставки лежат рядом с проектом, а игра
 * берёт их из public — туда ходит сборщик, а не диск.
 *
 * Папки копируются целиком и рекурсивно: добавили в Audio новый хрип — он
 * приедет в игру сам, править этот список не нужно.
 */
const ASSETS = [
  { from: 'Audio', to: 'public/assets/audio', what: 'звук' },
  { from: 'Splash', to: 'public/assets/splash', what: 'заставки' },
  { from: 'Ui', to: 'public/assets/ui', what: 'картинки интерфейса' },
];

const EXPORTS = [
  { blend: 'Env.blend', script: 'tools/export_props.py', what: 'окружение' },
  { blend: 'Player/Player.blend', script: 'tools/export_player.py', what: 'персонаж' },
  { blend: 'Zombie1/Zombie.blend', script: 'tools/export_zombie.py', what: 'зомби 1' },
  { blend: 'Zombie2/Zombie.blend', script: 'tools/export_zombie.py', what: 'зомби 2' },
];

/** Сколько файлов легло в папку, считая вложенные. */
async function countFiles(dir) {
  let total = 0;
  for (const item of await readdir(dir, { withFileTypes: true })) {
    total += item.isDirectory() ? await countFiles(resolve(dir, item.name)) : 1;
  }
  return total;
}

/** Один прогон Blender без интерфейса. */
function runBlender(task) {
  return new Promise((done) => {
    const blender = spawn(BLENDER, [
      '-b', resolve(PROJECT_ROOT, task.blend),
      '--python', resolve(import.meta.dirname, task.script),
    ]);

    let output = '';
    blender.stdout.on('data', (chunk) => { output += chunk; });
    blender.stderr.on('data', (chunk) => { output += chunk; });

    blender.on('error', (error) => done({ ok: false, output: `не удалось запустить Blender: ${error.message}` }));
    blender.on('close', (code) => done({ ok: code === 0, output }));
  });
}

/**
 * Пересборка всех моделей по кнопке из игры.
 *
 * Запускает Blender без интерфейса на каждом .blend проекта и прогоняет тот же
 * скрипт экспорта, что и вручную. Только для dev-сервера.
 */
function blenderExport() {
  return {
    name: 'blender-export',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/rebuild-props', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('POST');
          return;
        }

        const started = Date.now();
        const lines = [];
        let ok = true;

        // Сначала то, что просто копируется: это быстро, и если файла нет,
        // лучше сказать сразу, а не после трёх минут работы Blender.
        for (const asset of ASSETS) {
          const source = resolve(PROJECT_ROOT, asset.from);
          if (!existsSync(source)) {
            lines.push(`${asset.what}: нет папки ${asset.from}`);
            continue;
          }

          const target = resolve(import.meta.dirname, asset.to);

          // Сносим прежнее целиком, а не докладываем поверх. Иначе переименования
          // и перестановки не доезжают: файл, которого в исходной папке больше
          // нет, остаётся лежать в игре и подхватывается вместо нового.
          await rm(target, { recursive: true, force: true });
          await mkdir(target, { recursive: true });

          // Служебные файлы системы в игру не нужны, всё остальное — как есть,
          // вместе с вложенными папками: музыка разложена по номерам уровней.
          await cp(source, target, {
            recursive: true,
            filter: (path) => !basename(path).startsWith('.'),
          });

          lines.push(`${asset.what}: ${await countFiles(target)} файлов`);
        }

        // последовательно, а не разом: четыре Blender'а сразу только мешают друг другу
        for (const task of EXPORTS) {
          const result = await runBlender(task);
          ok = ok && result.ok;

          // Из вывода Blender берём строки самого скрипта и всё, что похоже на сбой.
          // Ошибки ловим отдельно: Blender завершается с кодом 0, даже когда
          // скрипт не найден или упал, — без этого сбой прошёл бы незамеченным.
          let reported = false;
          for (const line of result.output.split('\n')) {
            if (/\.glb —|моделей:/.test(line)) {
              lines.push(`${task.what}: ${line.trim()}`);
              reported = true;
            } else if (/Error|error:|Traceback|could not be opened/.test(line)) {
              lines.push(`${task.what}: ${line.trim()}`);
              ok = false;
            }
          }
          if (!result.ok || !reported) {
            ok = false;
            lines.push(`${task.what}: сборка не удалась`);
          }
        }

        res.statusCode = ok ? 200 : 500;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({
          ok,
          seconds: ((Date.now() - started) / 1000).toFixed(1),
          lines,
        }));
      });
    },
  };
}

/**
 * Сохранение расстановки из встроенного редактора: JSON локации переписывается
 * прямо в public/locations. Только для dev-сервера — в игре редактора нет.
 */
function locationSaver() {
  return {
    name: 'location-saver',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/save-location', async (req, res) => {
        res.setHeader('content-type', 'application/json');

        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ ok: false, error: 'POST' }));
          return;
        }

        try {
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          const { id, data } = JSON.parse(Buffer.concat(chunks).toString());

          // Имя приходит из браузера, поэтому доверять ему нельзя: берём только
          // само имя файла и сохраняем лишь поверх локации, которая уже есть.
          const name = basename(String(id ?? '')).replace(/[^\w-]/g, '');
          const file = resolve(import.meta.dirname, 'public/locations', `${name}.json`);
          if (!name || !existsSync(file)) throw new Error(`нет такой локации: ${id}`);
          await writeFile(file, JSON.stringify(data, null, 2) + '\n');

          res.statusCode = 200;
          res.end(JSON.stringify({ ok: true, file: `${name}.json` }));
        } catch (error) {
          res.statusCode = 500;
          res.end(JSON.stringify({ ok: false, error: error.message }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [blenderExport(), locationSaver()],
  server: {
    port: 5173,
    open: false,
    // Слушаем все интерфейсы, а не только localhost: иначе с телефона в той же
    // сети до игры не достучаться, а проверять на нём приходится постоянно.
    host: true,
  },
  // Пути в собранной странице — относительные. Иначе игра заводится только в
  // корне домена, а положенная в подпапку не находит даже собственный код.
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
});
