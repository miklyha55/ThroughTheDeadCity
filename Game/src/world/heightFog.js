import * as THREE from 'three';
import { CONFIG } from '../config.js';

const CFG = CONFIG.world;

/**
 * Слоистый туман: густой у земли, редеющий кверху.
 *
 * Своего такого в three нет. Штатных туманов там ровно два — линейный по
 * расстоянию и экспоненциальный, — и высота не входит в их формулу вовсе: оба
 * считаются от глубины точки в кадре. Поэтому дымка ложилась одинаково и на
 * землю у горизонта, и на крышу дома рядом с ней, а хотелось обратного —
 * чтобы даль тонула у земли, а всё высокое из неё выступало.
 *
 * Делается это подменой кусков шейдера, из которых three собирает свои
 * материалы. Способ грубый, но единственный, который кроет всё разом: дома,
 * землю, зомби, слитую статику — всё, что рисуется штатным материалом, без
 * единой правки в самих локациях и без своего материала на каждый случай.
 *
 * Числа вшиваются в текст, а не передаются как значения шейдера. Так пришлось
 * бы заводить их в общем наборе и следить, чтобы рендер их обновлял, — а они
 * за игру не меняются ни разу. Отсюда и требование: подменить раньше, чем
 * соберётся первый материал.
 *
 * Сам штатный туман при этом остаётся на месте и работает как работал: мы лишь
 * дописываем к его плотности поправку на высоту.
 */
export function installHeightFog() {
  const { fogGroundTop: top, fogGroundBottom: bottom, fogLift: lift } = CFG;

  // Ноль — значит слоистости не просят: не трогаем three вовсе.
  if (!(lift > 0)) return;

  const F = (value) => value.toFixed(4); // в GLSL число обязано быть с точкой

  // Вершинный шейдер начинает передавать точку в мире: из неё берётся высота.
  THREE.ShaderChunk.fog_pars_vertex = /* glsl */`
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogWorld;
#endif
`;

  /**
   * `transformed` — это точка после всех своих превращений: скина, морфов,
   * смещений. Берём именно её, а не `position`, иначе бегущий зомби считался бы
   * по своей исходной позе и туман на нём подрагивал бы на каждом шаге.
   */
  THREE.ShaderChunk.fog_vertex = /* glsl */`
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
#endif
`;

  THREE.ShaderChunk.fog_pars_fragment = /* glsl */`
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogWorld;

  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif
`;

  /**
   * Поправка на высоту.
   *
   * У земли туман остаётся прежним, к `fogGroundTop` он редеет до доли
   * `1 − fogLift`, выше уже не меняется. Полностью наверху его не снимаем даже
   * при единице — небо и дальние крыши должны сходиться по цвету, иначе на
   * горизонте прорежется черта.
   */
  THREE.ShaderChunk.fog_fragment = /* glsl */`
#ifdef USE_FOG

  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif

  float fogHigh = clamp((vFogWorld.y - ${F(bottom)}) / ${F(Math.max(0.001, top - bottom))}, 0.0, 1.0);
  fogFactor *= 1.0 - ${F(lift)} * fogHigh;

  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );

#endif
`;
}
