// Based on Quilez "warp" domain-warped FBM with smooth mouse-direction influence and page-scroll offset.
(function () {
  const container = document.getElementById('background-container');
  if (!container) return;

  const canvas = document.createElement('canvas');
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';
  canvas.setAttribute('aria-hidden', 'true');
  container.appendChild(canvas);

  const gl = canvas.getContext('webgl2', { antialias: false }) ||
             canvas.getContext('webgl', { antialias: false });
  if (!gl) {
    console.warn('WebGL not supported');
    return;
  }

  const isWebGL2 = !!gl.createVertexArray;
  if (!isWebGL2) {
    console.warn('WebGL2 not available — shader expects WebGL2 (GLSL ES 3.00). Use modern browser for best results.');
  }

  const DPR = Math.min(window.devicePixelRatio || 1, 1.5);

  // Render pipeline
  const vertSrc = `#version 300 es
precision mediump float;
layout(location=0) in vec2 a_position;
out vec2 v_uv;
void main() {
  v_uv = 0.5 * (a_position + 1.0);
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

  const fragSrc = `#version 300 es
precision mediump float;
in vec2 v_uv;
out vec4 fragColor;
uniform vec2 iResolution;
uniform float iTime;
uniform vec2 iMouse;
uniform vec2 iMouseDelta;
uniform vec2 iDir;
uniform float iScroll;
uniform vec3 iPalette[5];

const mat2 m = mat2( 0.8,  0.01, -0.3,  0.5 );

float noise( in vec2 p )
{
	return sin(p.x)*sin(p.y);
}

float fbm4( vec2 p )
{
    float f = 0.0;
    f += 0.5000*noise( p ); p = m*p*2.02;
    f += 0.2500*noise( p ); p = m*p*2.03;
    f += 0.1250*noise( p ); p = m*p*2.01;
    f += 0.0625*noise( p );
    return f*1.06667;
}

float fbm6( vec2 p )
{
    float f = 0.0;
    f += 0.500000*(0.5+0.5*noise( p )); p = m*p*2.02;
    f += 0.250000*(0.5+0.5*noise( p )); p = m*p*2.03;
    f += 0.125000*(0.5+0.5*noise( p )); p = m*p*2.01;
    f += 0.062500*(0.5+0.5*noise( p )); p = m*p*2.04;
    f += 0.031250*(0.5+0.5*noise( p )); p = m*p*2.01;
    f += 0.015625*(0.5+0.5*noise( p ));
    return f*1.03226;
}

vec2 fbm4_2( vec2 p )
{
    return vec2(fbm4(p), fbm4(p+vec2(7.8)));
}

vec2 fbm6_2( vec2 p )
{
    return vec2(fbm6(p+vec2(16.8)), fbm6(p+vec2(11.5)));
}

float func( vec2 q, out vec4 ron )
{
  q += 0.03*sin( vec2(0.27,0.23)*iTime + length(q)*vec2(4.1,4.3));

	vec2 o = fbm4_2( 0.9*q );

  o += 0.04*sin( vec2(0.12,0.14)*iTime + length(o));

  vec2 n = fbm6_2( 3.0*o );

	ron = vec4( o, n );

  float f = 0.5 + 0.5*fbm4( 1.8*q + 6.0*n );

  return mix( f, f*f*f*3.5, f*abs(n.x) );
}

void main() {
    vec2 fragCoord = v_uv * iResolution;
    
    vec2 p = (2.0*fragCoord - iResolution.xy) / iResolution.y;
    p.y += (iScroll - 0.5) * 3.0; // scroll offset
    float e = 2.0 / iResolution.y;

    vec4 on = vec4(0.0);
    float f = func(p, on);

    vec3 col = vec3(0.0);
    col = mix( iPalette[0], iPalette[1], f );
    col = mix( col, iPalette[2], dot(on.zw,on.zw) );
    col = mix( col, iPalette[3], 0.2 + 0.5*on.y*on.y );
    col = mix( col, iPalette[4], 0.5*smoothstep(1.2,1.3,abs(on.z)+abs(on.w)) );
    col = clamp( col*f*2.0, 0.0, 1.0 );

#if 1
    // gpu derivatives - bad quality, but fast
	  vec3 nor = normalize( vec3( dFdx(f)*iResolution.x, 6.0, dFdy(f)*iResolution.y ) );
#else    
    // manual derivatives - better quality, but slower
    vec4 kk;
 	  vec3 nor = normalize( vec3( func(p+vec2(e,0.0),kk)-f, 
                                2.0*e,
                                func(p+vec2(0.0,e),kk)-f ) );
#endif

    vec3 lig = normalize( vec3( 0.9, 0.2, -0.4 ) );
    float dif = clamp( 0.3+0.7*dot( nor, lig ), 0.0, 1.0 );
    vec3 lin = vec3(0.70,0.90,0.95)*(nor.y*0.5+0.5) + vec3(0.15,0.10,0.05)*dif;
    col *= 1.2*lin;
    col = 1.0 - col;
    col = 1.1*col*col;

    fragColor = vec4( col, 1.0 );
}
`;

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error('Shader compile error:', gl.getShaderInfoLog(s));
      gl.deleteShader(s);
      throw new Error('Shader compile error');
    }
    return s;
  }

  const vs = compile(gl.VERTEX_SHADER, vertSrc);
  const fs = compile(gl.FRAGMENT_SHADER, fragSrc);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error('Program link error:', gl.getProgramInfoLog(prog));
    throw new Error('Program link error');
  }

  // Buffer setup
  const quadVerts = new Float32Array([-1, -1, 3, -1, -1, 3]);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW);

  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  gl.bindVertexArray(null);

  // Shader uniforms
  const uResolution = gl.getUniformLocation(prog, 'iResolution');
  const uTime = gl.getUniformLocation(prog, 'iTime');
  const uMouse = gl.getUniformLocation(prog, 'iMouse');
  const uMouseDelta = gl.getUniformLocation(prog, 'iMouseDelta');
  const uDir = gl.getUniformLocation(prog, 'iDir');
  const uScroll = gl.getUniformLocation(prog, 'iScroll');
  const uPalette = gl.getUniformLocation(prog, 'iPalette');

  const timeScale = 5.0;

  let mouse = [0.5, 0.5];
  let prevMouse = [0.5, 0.5];
  let mouseDelta = [0.0, 0.0];

  const parallaxEffect = 0.15;
  let smoothedDir = [0.0, 0.0];

  const paletteIntensity = 0.65;
  const palettePeriod = 60.0;

  // Nicaragua-inspired (blues + white)
  const palNica = [
    0.05, 0.45, 0.85,   // bright blue
    0.40, 0.70, 1.00,   // lighter sky blue
    0.98, 0.98, 0.98,   // near-white center
    0.70, 0.85, 0.95,   // pale bluish tint
    0.02, 0.15, 0.40    // deep navy accent
  ];

  // Ireland-inspired (greens + white + orange)
  const palIrish = [
    0.06, 0.45, 0.16,   // deep green
    0.34, 0.66, 0.28,   // mid green
    0.98, 0.98, 0.98,   // near-white center
    1.00, 0.55, 0.08,   // warm orange
    0.90, 0.95, 0.80    // soft warm tint
  ];

  // Events
  window.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    const mx = (e.clientX - r.left) / r.width;
    const my = 1.0 - ((e.clientY - r.top) / r.height);
    mouse = [mx, my];

    const rawDx = mouse[0] - prevMouse[0];
    const rawDy = mouse[1] - prevMouse[1];
    prevMouse = mouse.slice(0);

    mouseDelta[0] = rawDx;
    mouseDelta[1] = rawDy;

    const mag = Math.hypot(rawDx, rawDy);
    let dirx = 0, diry = 0;
    if (mag > 0.0005) {
      dirx = rawDx / mag;
      diry = rawDy / mag;
    }

    const alpha = 0.08;
    smoothedDir[0] = smoothedDir[0] * (1 - alpha) + dirx * alpha;
    smoothedDir[1] = smoothedDir[1] * (1 - alpha) + diry * alpha;
  }, { passive: true });

  function getScrollNormalized() {
    const scrollTop = window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0;
    const max = Math.max(1, document.body.scrollHeight - window.innerHeight);
    return Math.min(1, Math.max(0, scrollTop / max));
  }

  function resize() {
    const w = Math.max(1, Math.floor(container.clientWidth * DPR));
    const h = Math.max(1, Math.floor(container.clientHeight * DPR));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      canvas.style.width = `${container.clientWidth}px`;
      canvas.style.height = `${container.clientHeight}px`;
      gl.viewport(0, 0, w, h);
    }
  }

  window.addEventListener('resize', resize);
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  // Render loop
  const start = performance.now();
  function render() {
    const now = (performance.now() - start) / 1000;

    mouseDelta[0] *= 0.86;
    mouseDelta[1] *= 0.86;
    const scrollNorm = getScrollNormalized();

    resize();

    gl.useProgram(prog);
    gl.bindVertexArray(vao);

    gl.uniform2f(uResolution, canvas.width, canvas.height);
    gl.uniform1f(uTime, now * timeScale);
    gl.uniform2f(uMouse, mouse[0], mouse[1]);
    gl.uniform2f(uMouseDelta, mouseDelta[0], mouseDelta[1]);
    gl.uniform2f(uDir, smoothedDir[0] * 0, smoothedDir[1] * 0);
    gl.uniform1f(uScroll, scrollNorm * -parallaxEffect);

    // Palette crossfade
    const t = 0.5 * (1 + Math.sin(now * 2 * Math.PI / palettePeriod));
    const palette = new Float32Array(15);
    for (let i = 0; i < 15; i++) {
      palette[i] = palNica[i] * (1 - t) + palIrish[i] * t;
      palette[i] *= paletteIntensity;
      palette[i] = 1 - palette[i];
    }
    gl.uniform3fv(uPalette, palette);

    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindVertexArray(null);
    gl.useProgram(null);

    requestAnimationFrame(render);
  }

  requestAnimationFrame(render);
})();