/**
 * Демо таблицы рекордов для разработки: `?board=demo` рисует финал с
 * выдуманными строками, чтобы вёрстку таблицы было видно без площадки — там
 * SDK нет, и живых данных она не отдаёт.
 */
export function showBoardDemo(ending) {
  ending.show();
  ending.showBoard({
    userRank: 3,
    entries: [
      entry(0, 'Stalker_77', 439200, '0'),
      entry(1, 'MoroZ', 452100, '1'),
      entry(2, 'Тихий', 471800, '2'),
      entry(3, 'Дед Мороз', 488300, '4'),
      entry(4, 'KoT', 502400, '3'),
      entry(5, 'Чёрный', 519600, '5'),
      entry(6, 'Волкодав', 534900, '6'),
      entry(7, 'Sanya', 551200, '4'),
      entry(8, 'Бродяга', 568700, '8'),
      entry(9, 'Улитка', 612300, '9'),
    ],
  });
}

function entry(rank, publicName, score, deaths) {
  return {
    rank,
    score,
    extraData: deaths,
    player: {
      publicName,
      getAvatarSrc: () => '',
    },
  };
}