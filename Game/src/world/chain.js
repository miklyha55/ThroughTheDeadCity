import { asset } from '../core/paths.js';

/**
 * Цепочка уровней: каждый знает, какой идёт за ним.
 *
 * Отдельного списка уровней нет намеренно — он был бы вторым источником правды
 * и однажды разошёлся бы с самими файлами. Цепочка собирается по ссылкам `next`
 * и обрывается либо на последнем уровне, либо на круге, если кто-то замкнул её
 * на начало.
 *
 * Нужна двоим: загрузчику — чтобы знать, какие заставки и дорожки готовить, — и
 * панели разработчика, чтобы переключать уровни стрелками.
 *
 * @param {string} firstId — с какого начинать
 * @returns {Promise<Array<{id: string, number: number, name: string}>>}
 */
export async function readChain(firstId) {
  const list = [];
  let id = firstId;

  while (id && !list.some((level) => level.id === id)) {
    let data;
    try {
      const res = await fetch(asset(`locations/${id}.json`));
      if (!res.ok) break;
      data = await res.json();
    } catch {
      break; // файла нет или он битый: дальше цепочку не построить
    }

    list.push({ id, number: data.number ?? list.length + 1, name: data.name ?? id });
    id = data.next;
  }
  return list;
}
