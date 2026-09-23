// Procedural facade shader (GLSL injected into MeshStandardMaterial, see materials.js).
//
// Walls carry per-vertex metric coordinates (u along the wall, height) plus style data, so every
// window, frame and joint is computed per pixel and stays crisp at any distance. Windows have real
// depth: the view ray is traced into the reveal (jambs, head, sill are shaded as separate surfaces
// and cast sun shadows onto the frame), then through the glass into a room box behind it
// (interior mapping: floor, ceiling lights, walls, desks, shelves). Nothing here needs textures.

export const FACADE_PARS = /* glsl */`
uniform float uNight;
uniform float uWet;
uniform float uSunVis;
uniform float uInnerDim;
varying vec4 vF;   // u along edge (m), height (m), edge length (m), wall top (m)
varying vec4 vS;   // style id, level height, seed, levels
float fHash(vec3 p) { p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float fVN(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = fHash(vec3(i, 1.0)), b = fHash(vec3(i + vec2(1.0, 0.0), 1.0)), c = fHash(vec3(i + vec2(0.0, 1.0), 1.0)), d = fHash(vec3(i + vec2(1.0, 1.0), 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Room behind a window. p0: entry point on the glass (x across the room, y above the floor, z = 0),
// r: view ray in wall space (z into the building). kind: 0 office, 1 flat, 2 parking deck, 3 hall, 4 lobby.
vec3 fRoom(vec3 p0, vec3 r, float W, float Hc, float D, float id, float lit, int kind) {
  float tx = r.x > 0.0 ? (W - p0.x) / r.x : (r.x < 0.0 ? -p0.x / r.x : 1e5);
  float ty = r.y > 0.0 ? (Hc - p0.y) / r.y : (r.y < 0.0 ? -p0.y / r.y : 1e5);
  float tz = D / r.z;
  float t = min(min(tx, ty), tz);
  vec3 hp = p0 + r * t;
  float h1 = fHash(vec3(id, 3.1, 7.7)), h2 = fHash(vec3(id, 5.3, 1.9)), h3 = fHash(vec3(id, 8.1, 2.3));
  vec3 wallC = kind == 1 ? mix(vec3(0.86, 0.8, 0.7), vec3(0.8, 0.82, 0.78), h1) : mix(vec3(0.86, 0.85, 0.82), vec3(0.78, 0.8, 0.83), h1);
  vec3 floorC = kind == 1 ? mix(vec3(0.42, 0.28, 0.17), vec3(0.55, 0.42, 0.3), h2)
              : kind == 2 ? vec3(0.36, 0.36, 0.35)
              : mix(vec3(0.38, 0.39, 0.4), mix(vec3(0.27, 0.32, 0.4), vec3(0.5, 0.46, 0.4), h3), step(0.5, h2));
  vec3 ceilC = kind == 2 ? vec3(0.45, 0.45, 0.44) : vec3(0.9, 0.9, 0.88);
  vec3 c; float lamp = 0.0;
  if (t == tz) {
    c = wallC * 0.92;
    if (kind == 0 || kind == 4) {
      if (h1 > 0.55 && hp.y > 0.9 && hp.y < 2.0 && abs(hp.x - W * 0.5) < W * 0.28) c = vec3(0.93, 0.94, 0.95);         // whiteboard
      else if (h1 < 0.4 && hp.y < 2.05 && hp.x < W * 0.55) {                                                         // shelf with files
        float cell = fHash(vec3(floor(hp.x * 7.0), floor(hp.y * 2.6), id));
        c = mix(vec3(0.45, 0.36, 0.26), mix(vec3(0.2, 0.25, 0.45), vec3(0.75, 0.62, 0.3), cell), step(0.12, fract(hp.y * 2.6)));
      }
      if (kind == 4 && hp.y < 2.1 && abs(hp.x - W * 0.5) < 0.9) c = vec3(0.6, 0.62, 0.64);                            // corridor door
    } else if (kind == 1) {
      if (h2 > 0.5 && hp.y < 1.9 && hp.x > W * 0.15 && hp.x < W * 0.6) c = mix(vec3(0.55, 0.42, 0.3), vec3(0.85, 0.84, 0.8), h3); // cupboard
      else if (hp.y > 1.3 && hp.y < 1.8 && abs(hp.x - W * 0.7) < 0.3) c = vec3(0.3, 0.35, 0.4);                          // picture
    } else if (kind == 2) {
      // parked cars against the back wall
      float slot = floor(hp.x / 2.5), fx = fract(hp.x / 2.5);
      float hc = fHash(vec3(slot, id, 4.0));
      if (hc > 0.3 && hp.y < 1.45 && fx > 0.1 && fx < 0.86) {
        vec3 car = mix(vec3(0.12), mix(vec3(0.75), vec3(0.45, 0.1, 0.1), step(0.8, hc)), step(0.55, hc));
        c = hp.y > 0.95 ? vec3(0.08, 0.09, 0.1) : car;
      }
    }
  } else if (t == ty) {
    if (r.y < 0.0) {
      c = floorC;
      if (kind == 2) c *= 0.9 + 0.2 * step(0.92, fract(hp.x / 2.5)) * 2.0;   // parking bay lines
    } else {
      c = ceilC;
      float lx = abs(hp.x - W * 0.5), lz = fract(hp.z / 2.4);
      if (kind == 2) lamp = step(abs(lz - 0.5), 0.04) * step(lx, W * 0.35);
      else if (kind != 3) lamp = step(abs(lz - 0.5), 0.12) * step(lx, min(W * 0.3, 0.7));
    }
  } else {
    c = wallC;
  }
  // desk / table in front of the window
  if ((kind == 0 || kind == 1) && r.y < 0.0 && p0.y > 0.75) {
    float td = (p0.y - 0.75) / -r.y;
    vec3 dp = p0 + r * td;
    if (td < t && h2 > 0.2 && dp.z > 0.5 && dp.z < 1.55 && dp.x > 0.3 && dp.x < W - 0.3) { c = kind == 1 ? vec3(0.5, 0.36, 0.24) : vec3(0.78, 0.74, 0.66); hp = dp; t = td; }
  }
  float day = 1.0 - uNight;
  float depth = clamp(hp.z / D, 0.0, 1.0);
  // offices keep their lights on during a grey afternoon, flats rarely
  float dayOn = day * step(h3, kind == 1 ? 0.08 : kind == 2 ? 1.0 : 0.42);
  vec3 light = vec3(kind == 2 ? 0.08 : 0.13) * day * mix(1.0, 0.25, depth)
             + dayOn * vec3(0.2, 0.2, 0.19)
             + lit * (kind == 1 ? vec3(1.0, 0.74, 0.46) * 0.42 : vec3(0.95, 0.93, 0.86) * 0.34) * mix(1.0, 0.55, depth) * (kind == 2 ? 0.7 : 1.0);
  if (kind == 3) light = vec3(0.06) * day + lit * vec3(0.7, 0.72, 0.75) * 0.3;
  return c * light + lamp * (lit * vec3(1.3, 1.25, 1.12) + dayOn * vec3(1.1, 1.08, 1.0) + day * vec3(0.05));
}
`;

// Writes: fCol (albedo), fGlass, fEmis, fRough, fMetal, and an optional wall-space normal (fN, fNSet)
// applied after the normal chunk (see materials.js).
export const FACADE_MAIN = /* glsl */`
vec3 fCol = diffuseColor.rgb;
float fGlass = 0.0; vec3 fEmis = vec3(0.0); float fRough = 0.88; float fMetal = 0.0;
vec3 fN = vec3(0.0, 0.0, 1.0); float fNSet = 0.0;
vec3 fNv = normalize(vNormal);
vec3 fBv = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
vec3 fTv;
{
  // tangent along +u: walls are built with u running a→b and the outward normal on the right
  vec3 nW = (vec4(fNv, 0.0) * viewMatrix).xyz;
  fTv = normalize((viewMatrix * vec4(-nW.z, 0.0, nW.x, 0.0)).xyz + vec3(1e-6));
  float dsg = dot(dFdx(-vViewPosition), fTv) * dFdx(vF.x) + dot(dFdy(-vViewPosition), fTv) * dFdy(vF.x);
  if (dsg < 0.0) fTv = -fTv;
}
{
  float u = vF.x, h = vF.y, L = vF.z, top = vF.w;
  bool inner = vS.x > 19.5;            // interior face of an exterior wall
  int st = int(vS.x - (inner ? 20.0 : 0.0) + 0.5);
  // seed is interpolated per pixel; round it so the hash is identical across a whole wall
  float lh = max(vS.y, 2.0), seed = floor(vS.z * 8.0 + 0.5), levels = floor(vS.w + 0.5);
  float fl = floor(h / lh), fy = h - fl * lh;
  float aa = max(fwidth(u), fwidth(h));               // metres per pixel → fade fine detail
  float fine = 1.0 - smoothstep(0.012, 0.05, aa);
  float fine2 = 1.0 - smoothstep(0.006, 0.02, aa);
  vec3 rdv = normalize(-vViewPosition);
  vec3 ray = vec3(dot(rdv, fTv), dot(rdv, fBv), max(-dot(rdv, fNv), 0.03));
  vec3 sunW = vec3(0.0, 1.0, 0.0);
#if NUM_DIR_LIGHTS > 0
  vec3 sv = directionalLights[0].direction;
  sunW = vec3(dot(sv, fTv), dot(sv, fBv), dot(sv, fNv));
#endif

  // ---- wall surface ----
  if (!inner && st != 11 && st != 13) {
    float grain = fHash(vec3(floor(u * 18.0), floor(h * 18.0), seed)) - 0.5;
    fCol *= 1.0 + grain * 0.08 * fine;
    // large-scale mottling (repairs, uneven weathering)
    fCol *= 0.94 + 0.12 * fVN(vec2(u, h) * 0.35 + seed);
    // splash zone and plinth
    float plinth = st == 5 || st == 10 ? 0.5 : st == 7 || st == 6 || st >= 14 ? 0.0 : 0.3;
    if (h < plinth) {
      fCol = mix(fCol, vec3(0.42, 0.41, 0.39), 0.7) * (0.9 + 0.2 * fVN(vec2(u * 3.0, h * 3.0)));
      if (h > plinth - 0.03) { fN = vec3(0.0, 0.6, 0.8); fNSet = 1.0; }
    }
    fCol *= mix(0.8, 1.0, smoothstep(0.0, 0.7, h));
    // run-off below the roof edge
    float streak = fHash(vec3(floor(u * 1.3), 7.0, seed));
    fCol *= 1.0 - 0.07 * streak * smoothstep(top - 5.0, top - 0.3, h);
    // metal coping at the roof edge
    if (st != 10 && st < 15 && h > top - 0.14) { fCol = vec3(0.34, 0.35, 0.36); fMetal = 0.4; fRough = 0.45; if (h < top - 0.1) { fN = vec3(0.0, -0.5, 0.86); fNSet = 1.0; } }
  } else if (inner && fy < 0.08) { fCol = vec3(0.36, 0.35, 0.34); }

  // ---- window layout per style: an opening rectangle in (u, floor height) ----
  bool upper = fl < levels && h < top - 0.3;
  bool hasO = false;
  float ox0 = 0.0, ow = 0.0, oy0 = 0.0, oh = 0.0;
  float rdep = 0.16, fw = 0.06, mullSp = 0.0, tranY = -1.0;
  float roomU0 = 0.0, roomW = 3.75, roomD = 5.5, cellId = 0.0, blindOK = 1.0, litP = 0.3;
  int kind = 0;
  vec3 frameCol = vec3(0.42, 0.43, 0.44);
  bool sill = false;
  float gothArch = 0.0;
  if (st == 0) { // ribbon windows
    float m = 0.45;
    if (upper && L > 2.0 * m + 1.0) {
      hasO = true; ox0 = m; ow = L - 2.0 * m; oy0 = 1.05; oh = lh - 0.5 - 1.05;
      mullSp = 1.25; tranY = oh * 0.72; rdep = 0.1; fw = 0.05;
      roomW = 3.75; roomU0 = m; cellId = floor((u - m) / 1.25);
    }
    fCol *= 1.0 - 0.05 * fine * step(0.9, fract(h * 4.0));             // board-form lines on the spandrel
    if (fy < 1.05 && fy > 0.98 && hasO) { fCol = vec3(0.5, 0.51, 0.52); fMetal = 0.3; fRough = 0.5; fN = vec3(0.0, 0.7, 0.7); fNSet = 1.0; }
  } else if (st == 1 || st == 4 || st == 5 || st == 9) { // punched windows
    float sp = st == 5 ? 2.9 : st == 9 ? 4.2 : 2.7;
    float ww = st == 5 ? 1.25 : st == 9 ? 1.1 : 1.7;
    float wy0 = st == 5 ? 0.9 : 0.95, wy1 = st == 5 ? 2.25 : lh - 0.65;
    if (st == 9) { wy0 = 2.0; wy1 = top - 1.6; upper = h < top - 1.0; fl = 0.0; fy = h; }
    float n = floor((L - 0.8) / sp);
    if (upper && n >= 1.0) {
      float start = (L - n * sp) * 0.5;
      float ci = floor((u - start) / sp);
      if (ci >= 0.0 && ci < n) {
        hasO = true; cellId = ci;
        ox0 = start + ci * sp + (sp - ww) * 0.5; ow = ww; oy0 = wy0; oh = wy1 - wy0;
        rdep = st == 9 ? 0.35 : st == 4 ? 0.24 : st == 5 ? 0.16 : 0.2;
        mullSp = st == 9 ? 0.0 : ww > 1.0 ? ww * 0.5 : 0.0;
        tranY = st == 1 ? oh * 0.75 : -1.0;
        sill = true;
        roomW = sp * 2.0; roomU0 = start + floor(ci * 0.5) * sp * 2.0;
        if (st == 5) { kind = 1; frameCol = vec3(0.93, 0.93, 0.91); litP = 0.5; roomD = 4.5; fw = 0.07; }
        if (st == 9) { kind = 3; frameCol = vec3(0.3, 0.3, 0.32); blindOK = 0.0; roomW = L; roomU0 = 0.0; roomD = 14.0; litP = 0.2; }
      }
    }
    if (st == 4) { // brick bond
      float row = floor(h / 0.0775);
      float bu = u / 0.25 + mod(row, 2.0) * 0.5;
      float mort = max(step(fract(h / 0.0775), 0.13), step(fract(bu), 0.05));
      float bv = fHash(vec3(floor(bu), row, seed)) - 0.5;
      vec3 brick = fCol * (1.0 + bv * 0.22);
      fCol = mix(fCol * 0.93, mix(brick, vec3(0.62, 0.6, 0.56), mort), fine2);
    }
    if (st == 5 && hasO && u > ox0 - 0.06 && u < ox0 + ow + 0.06 && fy > oy0 + oh + 0.02 && fy < oy0 + oh + 0.24) fCol = mix(fCol, vec3(0.8), 0.5); // roller shutter box
  } else if (st == 2) { // modern panels with irregular tall windows
    float sp = 1.25;
    float ci = floor(u / sp); float cx = fract(u / sp) * sp;
    float joint = max(step(cx, 0.02), step(abs(fy - 0.02), 0.02));
    fCol *= 1.0 - 0.25 * joint * fine;
    if (joint > 0.5 && fine > 0.5) { fN = vec3(cx < 0.01 ? -0.5 : 0.5, 0.0, 0.86); fNSet = 1.0; }
    fCol *= 0.92 + 0.16 * fHash(vec3(ci, fl, seed));
    if (upper && u > 0.6 && u < L - 0.6 && fHash(vec3(ci, fl, seed + 3.0)) > 0.42) {
      hasO = true; cellId = ci; ox0 = ci * sp + 0.17; ow = sp - 0.34; oy0 = 0.55; oh = lh - 0.9;
      rdep = 0.12; fw = 0.05; frameCol = vec3(0.16); roomW = 3.75; roomU0 = floor(u / 3.75) * 3.75;
    }
  } else if (st == 3) { // curtain wall
    if (h < top - 0.3) {
      if (fy > lh - 0.45) { fCol = vec3(0.2, 0.22, 0.24); fMetal = 0.5; fRough = 0.4; }
      else { hasO = true; ox0 = 0.0; ow = L; oy0 = 0.0; oh = lh - 0.45; mullSp = 1.5; tranY = 1.1; rdep = 0.03; fw = 0.05;
             cellId = floor(u / 1.5); roomW = 4.5; roomU0 = floor(u / 4.5) * 4.5; frameCol = vec3(0.3, 0.31, 0.33); }
    }
  } else if (st == 6) { // hall: corrugated cladding + clerestory
    float cor = sin(u * 31.4159);
    fCol *= 1.0 + 0.06 * cor * fine;
    if (fine > 0.3) { fN = vec3(cos(u * 31.4159) * 0.25, 0.0, 0.97); fNSet = 1.0; }
    fMetal = 0.15; fRough = 0.55;
    if (h > top - 2.2 && h < top - 0.9 && L > 2.5) {
      hasO = true; fl = 0.0; fy = h; ox0 = 1.0; ow = L - 2.0; oy0 = top - 2.2; oh = 1.3; mullSp = 2.0; rdep = 0.08;
      kind = 3; blindOK = 0.0; roomW = L; roomU0 = 0.0; roomD = 20.0; cellId = floor(u / 2.0); litP = 0.4;
    }
    if (h < 0.6) fCol = vec3(0.55, 0.54, 0.52);
  } else if (st == 7 || st == 12) { // parking deck (12: behind a metal mesh screen)
    float bay = floor(u / 5.4);
    if (upper && fy > 1.05 && fy < lh - 0.35 && u > 0.5 && u < L - 0.5 && mod(u, 5.4) > 0.4) {
      hasO = true; ox0 = bay * 5.4 + 0.4; ow = 5.0; oy0 = 1.05; oh = lh - 1.4; rdep = 0.0; fw = 0.0;
      kind = 2; blindOK = 0.0; roomW = 5.4 * 3.0; roomU0 = floor(u / 16.2) * 16.2; roomD = 16.0; cellId = bay; litP = 0.9;
    }
  } else if (st == 14 || st == 15) { // baroque town house / palace (15: sandstone ashlar)
    vec3 stone = st == 15 ? fCol : vec3(0.78, 0.7, 0.55);   // Burgsandstein (ashlar: the building's own stone)
    float ph = st == 15 ? 0.0 : 0.85;                      // plinth height (rusticated)
    // corner pilasters (Lisenen)
    bool pil = u < 0.55 || u > L - 0.55;
    if (st == 15) {
      // ashlar courses 0.42 m high, blocks 0.9 m, staggered joints
      float row = floor(h / 0.42), bu = u / 0.9 + mod(row, 2.0) * 0.5;
      float jv = step(fract(h / 0.42), 0.03), ju = step(fract(bu), 0.012);
      fCol = mix(stone, stone * (0.88 + 0.2 * fHash(vec3(floor(bu), row, seed))), 0.8);
      fCol *= 1.0 - 0.25 * max(jv, ju) * fine2;
      if (max(jv, ju) > 0.5 && fine > 0.5) { fN = vec3(0.0, jv > 0.5 ? -0.5 : 0.0, 0.86); fNSet = 1.0; }
    } else if (pil) {
      fCol = stone * (0.92 + 0.1 * fVN(vec2(u, h) * 2.0));
      if (abs(u - 0.55) < 0.03 || abs(u - (L - 0.55)) < 0.03) { fN = vec3(u < L * 0.5 ? 0.6 : -0.6, 0.0, 0.8); fNSet = 1.0; }
    }
    // rusticated ground floor: horizontal grooves
    if (h < lh && st == 14 && !pil) {
      float g = step(fract(h / 0.45), 0.06);
      fCol = mix(fCol, fCol * 0.8, g * fine);
      if (g > 0.5 && fine > 0.5) { fN = vec3(0.0, -0.6, 0.8); fNSet = 1.0; }
    }
    // string course at every floor, cornice under the eaves
    float sc = fy < 0.18 && fl >= 1.0 ? 1.0 : 0.0;
    if (sc > 0.5) { fCol = stone * 0.95; fN = vec3(0.0, fy < 0.06 ? -0.7 : 0.35, 0.7); fNSet = 1.0; }
    if (h > top - 0.55) {
      fCol = stone * (h > top - 0.2 ? 1.0 : 0.82);
      fN = vec3(0.0, h > top - 0.2 ? 0.45 : -0.75, 0.66); fNSet = 1.0;
    }
    if (h < ph) { fCol = stone * 0.8 * (0.9 + 0.2 * fVN(vec2(u * 2.0, h * 4.0))); }
    // tall windows with sandstone surrounds (Fensterfaschen), keystone, sill
    float sp = 2.7, ww = 1.15;
    float n = floor((L - 1.4) / sp);
    if (fl < levels && h < top - 0.6 && n >= 1.0) {
      float start = (L - n * sp) * 0.5;
      float ci = floor((u - start) / sp);
      if (ci >= 0.0 && ci < n) {
        float wy0 = fl < 0.5 ? max(ph + 0.15, 0.9) : 0.75, wy1 = lh - 0.55;
        hasO = true; cellId = ci; ox0 = start + ci * sp + (sp - ww) * 0.5; ow = ww; oy0 = wy0; oh = wy1 - wy0;
        rdep = 0.28; fw = 0.06; mullSp = ww * 0.5; tranY = oh * 0.68; sill = true;
        frameCol = vec3(0.93, 0.92, 0.88); kind = 1; litP = 0.45; roomW = sp * 2.0; roomU0 = start + floor(ci * 0.5) * sp * 2.0; roomD = 5.5;
        float wx = u - ox0, wy = fy - oy0;
        // the surround: 14 cm band around the opening, ears at the top corners, keystone
        bool band = wx > -0.16 && wx < ow + 0.16 && wy > -0.1 && wy < oh + 0.16 && !(wx >= 0.0 && wx <= ow && wy >= 0.0 && wy <= oh);
        bool key = abs(wx - ow * 0.5) < 0.13 && wy > oh && wy < oh + 0.3;
        if (band || key) {
          fCol = stone * (key ? 0.96 : 0.9);
          float inside = min(min(wx + 0.16, ow + 0.16 - wx), min(wy + 0.1, oh + 0.16 - wy));
          if (inside < 0.03) { fN = vec3(0.0, 0.0, 1.0) + vec3(wx < 0.0 ? -0.5 : wx > ow ? 0.5 : 0.0, wy < 0.0 ? -0.5 : wy > oh ? 0.5 : 0.0, 0.0); fN = normalize(fN); fNSet = 1.0; }
        }
      }
    }
  } else if (st == 16) { // Gothic church: sandstone ashlar, buttresses, tall lancet windows with tracery
    vec3 stone = fCol;
    float row = floor(h / 0.38), bu = u / 0.8 + mod(row, 2.0) * 0.5;
    float jv = step(fract(h / 0.38), 0.03), ju = step(fract(bu), 0.012);
    fCol = mix(stone, stone * (0.84 + 0.26 * fHash(vec3(floor(bu), row, seed))), 0.85);
    fCol *= 1.0 - 0.25 * max(jv, ju) * fine2;
    if (max(jv, ju) > 0.5 && fine > 0.5) { fN = vec3(0.0, jv > 0.5 ? -0.5 : 0.0, 0.86); fNSet = 1.0; }
    fCol *= 0.82 + 0.18 * fVN(vec2(u * 0.25, h * 0.12) + seed);   // centuries of weathering
    float nb = max(1.0, floor(L / 6.0)), bw = L / nb, bx = mod(u, bw);
    bool butt = bx < 0.6 || bx > bw - 0.6;
    if (butt && h < top - 0.8) { fCol *= 0.9; fN = vec3(bx < 0.6 ? -0.4 : 0.4, 0.0, 0.92); fNSet = 1.0; }
    fl = 0.0; fy = h; upper = h < top - 0.5;
    float ww = min(2.4, bw * 0.45), wy0 = max(2.4, top * 0.16), wy1 = top - max(1.2, top * 0.1);
    if (upper && L > 3.0 && wy1 - wy0 > 2.5 && !butt) {
      float ci = floor(u / bw);
      hasO = true; cellId = ci; ox0 = ci * bw + (bw - ww) * 0.5; ow = ww; oy0 = wy0; oh = wy1 - wy0;
      rdep = 0.5; fw = 0.05; mullSp = ww / 3.0; tranY = -1.0; frameCol = stone * 0.75;
      kind = 3; blindOK = 0.0; roomW = L; roomU0 = 0.0; roomD = 20.0; litP = 0.25;
      gothArch = 1.0;
    }
  } else if (st == 10) { // gable end (plaster)
    fCol *= 0.97;
  } else if (st == 11) { // interior walls: plain paint with skirting
    if (fy < 0.1) fCol = vec3(0.35, 0.34, 0.33);
  } else if (st == 13) { // entrance door (quad in front of the wall)
    fl = 0.0; fy = h;
    hasO = true; ox0 = 0.07; ow = L - 0.14; oy0 = 0.0; oh = top - 0.08; mullSp = ow > 1.5 ? ow * 0.5 : 0.0; tranY = oh > 2.5 ? 2.25 : -1.0; rdep = 0.25; fw = 0.07;
    frameCol = vec3(0.19, 0.2, 0.21); kind = 4; blindOK = 0.0; roomW = ow + 4.0; roomU0 = ox0 - 2.0; roomD = 8.0; litP = 0.85;
    fCol = frameCol;
  }

  // ---- window: reveal, frame, blinds, glass and the room behind ----
  float wx = u - ox0, wy = fy - oy0;
  bool inO = hasO && wx >= 0.0 && wx <= ow && wy >= 0.0 && wy <= oh;
  // lancet: above the springing line the opening is the intersection of two arcs
  if (inO && gothArch > 0.5) { float sy = oh - ow * 0.866; if (wy > sy && (length(vec2(wx, wy - sy)) > ow || length(vec2(wx - ow, wy - sy)) > ow)) inO = false; }
  if (hasO && !inO && !inner && sill && wx > -0.05 && wx < ow + 0.05) {
    // protruding window sill with its shadow line, and rain streaks running down from its ends
    if (wy > -0.06 && wy < 0.0) { fCol = st == 5 ? vec3(0.82, 0.82, 0.8) : vec3(0.6, 0.61, 0.62); fMetal = 0.25; fRough = 0.45; fN = vec3(0.0, 0.75, 0.66); fNSet = 1.0; }
    else if (wy > -0.11 && wy <= -0.06) fCol *= 0.72;
  }
  if (hasO && !inO && !inner && wy < 0.0 && wy > -2.2 && wx > -0.3 && wx < ow + 0.3) {
    float e = exp(-pow(wx / 0.07, 2.0)) + exp(-pow((wx - ow) / 0.07, 2.0)) + 0.6 * exp(-pow((wx - ow * fHash(vec3(cellId, fl, seed + 2.0))) / 0.1, 2.0));
    fCol *= 1.0 - 0.14 * e * (1.0 + wy / 2.2) * fHash(vec3(cellId, fl, seed + 9.0));
  }
  if (inO && !inner) {
    float rd = rdep * (1.0 - smoothstep(0.04, 0.12, aa));   // flatten at distance
    vec2 g = vec2(wx, wy) + ray.xy * (rd / ray.z);            // where the view ray meets the glass plane
    if (g.x < 0.0 || g.x > ow || g.y < 0.0 || g.y > oh) {
      // the ray hits the reveal first
      float tl = ray.x < 0.0 ? -wx / ray.x : 1e5, tr = ray.x > 0.0 ? (ow - wx) / ray.x : 1e5;
      float tb = ray.y < 0.0 ? -wy / ray.y : 1e5, tt = ray.y > 0.0 ? (oh - wy) / ray.y : 1e5;
      float tm = min(min(tl, tr), min(tb, tt));
      float dep = clamp(tm * ray.z / max(rd, 1e-3), 0.0, 1.0);
      vec3 revC = st == 13 ? frameCol : fCol;
      if (tm == tb) { fN = vec3(0.0, 1.0, 0.0); if (sill) revC = mix(revC, vec3(0.8), 0.4); }
      else if (tm == tt) fN = vec3(0.0, -1.0, 0.0);
      else if (tm == tl) fN = vec3(1.0, 0.0, 0.0);
      else fN = vec3(-1.0, 0.0, 0.0);
      fNSet = 1.0;
      fCol = revC * mix(1.0, 0.72, dep);
    } else {
      float fr = 0.0;
      if (fw > 0.0) {
        fr = max(max(step(g.x, fw), step(ow - fw, g.x)), max(step(g.y, fw), step(oh - fw, g.y)));
        if (mullSp > 0.0) { float mx = mod(g.x, mullSp); fr = max(fr, step(min(mx, mullSp - mx), fw * 0.55)); }
        if (tranY > 0.0) fr = max(fr, step(abs(g.y - tranY), fw * 0.55));
        if (st == 14 || st == 15) { fr = max(fr, step(abs(g.y - tranY * 0.5), fw * 0.4)); fr = max(fr, step(abs(g.y - (tranY + (oh - tranY) * 0.5)), fw * 0.4)); }
        fr *= 1.0 - smoothstep(0.025, 0.07, aa);
      }
      // sun shadow of the reveal on the recessed window
      float shade = 1.0;
      if (sunW.z > 0.02 && rd > 0.0) {
        vec2 sg = g + sunW.xy * (rd / sunW.z);
        if (sg.x < 0.0 || sg.x > ow || sg.y < 0.0 || sg.y > oh) shade = 1.0 - 0.5 * uSunVis;
      }
      float hsh = fHash(vec3(cellId, fl, seed + 11.0));
      float blind = blindOK < 0.5 ? 0.0 : hsh < 0.66 ? 0.0 : hsh < 0.9 ? (hsh - 0.66) * 3.0 : 1.0;
      float farW = smoothstep(0.05, 0.22, aa);           // far away: window-to-window differences soften
      blind *= 1.0 - 0.75 * farW;
      bool inBlind = g.y / oh > 1.0 - blind;
      float lit = step(fHash(vec3(cellId, fl, seed + 23.0)), litP) * uNight;
      vec3 warm = mix(vec3(1.0, 0.78, 0.5), vec3(0.85, 0.9, 1.0), step(0.7, fHash(vec3(cellId, fl, seed + 29.0))));
      bool curtain = kind == 1 && fHash(vec3(cellId, fl, seed + 31.0)) < 0.6;
      if (st == 13 && abs(g.x - ow * 0.5) < 0.2 && abs(g.x - ow * 0.5) > 0.1 && g.y > 0.9 && g.y < 1.4) { fr = 1.0; frameCol = vec3(0.7); } // door handles
      if (fr > 0.5) { fCol = frameCol * shade; fRough = 0.5; fMetal = 0.2; }
      else if (inBlind) {
        float slat = 0.8 + 0.2 * smoothstep(0.35, 0.65, fract(g.y * 12.5));
        fCol = (kind == 1 ? vec3(0.8, 0.79, 0.76) : vec3(0.47, 0.49, 0.51)) * mix(0.9, slat, fine2) * shade;
        fRough = 0.55; fMetal = kind == 1 ? 0.0 : 0.3;
        fEmis = warm * lit * 0.3;
      } else if (kind == 2) {
        // open parking deck: no glass
        vec3 p0 = vec3(ox0 + g.x - roomU0, oy0 + g.y, 0.0);
        vec3 room = fRoom(p0, ray, roomW, lh - 0.35, roomD, roomU0 + fl * 17.0 + seed, max(lit, 0.25 * (1.0 - uNight)), 2);
        fCol = vec3(0.0); fEmis = room; fRough = 1.0;
      } else {
#ifndef CUTOUT
        vec3 p0 = vec3(ox0 + g.x - roomU0, (st == 9 || st == 6 || st == 13) ? oy0 + g.y : oy0 + g.y, 0.0);
        float Hc = (st == 9 || st == 6) ? top - 0.5 : st == 13 ? 3.2 : lh - 0.35;
        float rid = floor((ox0 + g.x - roomU0) / roomW) + roomU0 * 1.7 + fl * 13.0 + seed;
        float rlit = step(fHash(vec3(rid, 5.0, seed)), litP) * uNight;
        vec3 room = fRoom(p0, ray, roomW, Hc, roomD + 2.0 * fHash(vec3(rid, 1.0, 2.0)), rid, rlit, kind);
        float F = 0.04 + 0.96 * pow(1.0 - ray.z, 5.0);
        fEmis = room * (1.0 - F) * 0.72;
        fEmis = mix(fEmis, vec3(0.03, 0.032, 0.035) * (1.0 - uNight) + fEmis * uNight, farW * 0.7);
        if (curtain) {
          // sheer net curtain (Gardine) behind the glass
          float fold = 0.85 + 0.15 * sin(g.x * 40.0) * fine2;
          fEmis = mix(fEmis, vec3(0.9, 0.88, 0.84) * (0.2 * (1.0 - uNight) + vec3(0.5, 0.4, 0.28) * rlit) * fold, 0.75);
        }
#endif
        fCol = vec3(0.1, 0.112, 0.118); fGlass = 1.0; fRough = 0.05; fMetal = 0.45;
      }
    }
  }
}
#ifdef CUTOUT
if (fGlass > 0.5) discard;
#endif
if (vS.x > 19.5) fCol *= uInnerDim;
diffuseColor.rgb = fCol;
`;

// applied after <normal_fragment_maps>
export const FACADE_NORMAL = /* glsl */`
if (fNSet > 0.5) normal = normalize(fTv * fN.x + fBv * fN.y + fNv * fN.z);
`;
