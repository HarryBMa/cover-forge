import { MeshPhysicalMaterial, Vector2, type Texture } from 'three';
import type { PreviewMaterial } from '../types/template';
import type { FoilStyle } from '../types/studio';

/** Holographic foil on part of the print: where it shows (a mask over the sheet) and how it looks. */
export interface Foil {
  /** White where the foil shows (its red channel times alpha), same layout as the artwork. */
  mask: Texture;
  style: FoilStyle;
  /** The sheet's size in mm, so flakes and swirls have a real size whatever the template. */
  sheetMm: [number, number];
}

/** The foil looks, as on the PC-GAMEPAK holo sticker page. Values 0–1. */
const FOIL_LOOKS: Record<FoilStyle, { flakeSize: number; flakeTilt: number; glints: number; irid: number; rainbow: number; swirl: number; hue: number; pastel: number; lines: number }> = {
  silver: { flakeSize: 0.35, flakeTilt: 0.25, glints: 0.35, irid: 0.75, rainbow: 0.5, swirl: 0.45, hue: 0.25, pastel: 0.45, lines: 0.12 },
  oil: { flakeSize: 0.2, flakeTilt: 0.05, glints: 0.1, irid: 1, rainbow: 0.15, swirl: 0.3, hue: 0.6, pastel: 0.05, lines: 0.05 },
  glitter: { flakeSize: 0.75, flakeTilt: 0.9, glints: 1, irid: 0.9, rainbow: 0.6, swirl: 0.5, hue: 0.4, pastel: 0.15, lines: 0 },
  pastel: { flakeSize: 0.3, flakeTilt: 0.2, glints: 0.3, irid: 0.85, rainbow: 0.55, swirl: 0.4, hue: 0.2, pastel: 0.38, lines: 0.14 },
};

/** A sticker on the reference page is about this many mm tall; its noise scales were tuned at that size. */
const REF_MM = 30;

const FOIL_HEAD = /* glsl */ `
uniform sampler2D foilMask;
uniform vec2 foilSheet;
uniform float fIrid, fFlakeScale, fFlakeTilt, fGlints, fRainbow, fSwirl, fHue, fPastel, fLines;
#define F_PI 3.14159265
float fHash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
vec2 fHash2(vec2 p){float n=fHash(p);return vec2(n,fHash(p+n*17.1));}
float fNoise(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.-2.*f);
 return mix(mix(fHash(i),fHash(i+vec2(1,0)),u.x),mix(fHash(i+vec2(0,1)),fHash(i+vec2(1,1)),u.x),u.y);}
float fFbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*fNoise(p);p=p*2.03+7.1;a*=.5;}return v;}
vec3 fVoro(vec2 p){vec2 i=floor(p),f=fract(p);float md=9.;vec2 id=i;
 for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){vec2 g=vec2(float(x),float(y));vec2 r=g+fHash2(i+g)-f;float d=dot(r,r);if(d<md){md=d;id=i+g;}}
 return vec3(id,sqrt(md));}
vec3 fSpectrum(float x){return clamp(.5+.5*cos(2.*F_PI*(x+vec3(0.,.33,.67))),0.,1.);}
vec3 fThinFilm(float cosI,float d){
 const float n=1.42; vec3 lam=vec3(650.,535.,455.);
 float s2=(1.-cosI*cosI)/(n*n); float cosT=sqrt(max(1.-s2,0.));
 return .5+.5*cos(4.*F_PI*n*d*cosT/lam);
}
// N, V: view space (the lights sit by the camera, so turning the model sweeps the colours across it).
vec3 holoFoil(vec2 uv, vec3 N, vec3 V){
 vec2 q=uv*foilSheet/${REF_MM.toFixed(1)};
 vec3 up=abs(N.y)<.95?vec3(0.,1.,0.):vec3(1.,0.,0.);
 vec3 T1=normalize(cross(up,N)), T2=cross(N,T1);
 vec3 L=normalize(vec3(-.55,.75,1.1)), L2=normalize(vec3(.8,-.3,.9));
 float h=fFbm(q*fSwirl+3.);
 vec2 grad=vec2(fFbm(q*fSwirl+vec2(.01,0.)+3.)-h,fFbm(q*fSwirl+vec2(0.,.01)+3.)-h)/.01;
 vec2 fq=q*fFlakeScale;
 vec3 vc=fVoro(fq); float fr=fHash(vc.xy); vec2 ft=fHash2(vc.xy+3.)-.5;
 // Flakes smaller than a pixel would only sparkle as noise: fade them out with distance.
 float fAA=clamp(1.5-length(fwidth(fq)),0.,1.);
 vec2 tilt=-grad*.07+ft*fFlakeTilt*fAA;
 vec3 Np=normalize(N+T1*tilt.x+T2*tilt.y);
 vec3 H=normalize(L+V), H2=normalize(L2+V);
 float cosI=clamp(dot(Np,V),0.,1.);
 vec3 film=smoothstep(.05,.95,fThinFilm(cosI,fHue+520.*h+120.*fr*fFlakeTilt));
 float a=1.1+h*2.;
 vec3 Tg=normalize(T1*cos(a)+T2*sin(a));
 float g=dot(H,Tg)*3.2+dot(H2,Tg)*1.4+h*1.3+fHue/400.;
 vec3 irid=mix(film,fSpectrum(fract(g)),fRainbow);
 vec3 albedo=mix(vec3(.80,.82,.86),mix(irid,vec3(1.),fPastel),fIrid);
 vec3 Rf=reflect(-V,Np);
 float env=.35+.9*smoothstep(-.1,.8,Rf.y)+.35*smoothstep(.3,1.,-Rf.x);
 float diff=max(dot(Np,L),0.)*.55+max(dot(Np,L2),0.)*.2;
 float spec=pow(max(dot(Np,H),0.),70.)*1.1+pow(max(dot(Np,H2),0.),40.)*.3;
 float glint=pow(max(dot(Np,H),0.),900.)*step(1.-fGlints*.6,fr)*10.*smoothstep(0.,.08,fFlakeTilt)*fAA;
 float F=pow(1.-cosI,5.);
 vec3 foil=albedo*(env*.55+diff)+spec*mix(vec3(1.),irid,.4)+glint+F*.35;
 vec2 qm=uv*foilSheet;
 float ph=(qm.x*cos(.5)+qm.y*sin(.5))*50.;
 float lines=fLines*clamp(1.-fwidth(ph)/F_PI,0.,1.);
 foil*=1.-lines+lines*(.5+.5*sin(ph));
 // The page's colours are display values; the renderer works in linear light (a gentler curve keeps the pastel bright).
 return pow(max(foil,0.),vec3(1.6));
}
`;

const FOIL_MIX = /* glsl */ `
{
 vec4 fm=texture2D(foilMask,vMapUv);
 float holo=fm.r*fm.a;
 if(holo>.002) outgoingLight=mix(outgoingLight,holoFoil(vMapUv,normal,normalize(vViewPosition)),holo);
}
#include <opaque_fragment>`;

/** Adds the foil to a printed material: the mask picks where, the shader replaces the print's colour there. */
function addFoil(mat: MeshPhysicalMaterial, foil: Foil): void {
  const s = FOIL_LOOKS[foil.style] ?? FOIL_LOOKS.pastel;
  const uniforms = {
    foilMask: { value: foil.mask },
    foilSheet: { value: new Vector2(...foil.sheetMm) },
    fIrid: { value: s.irid },
    fFlakeScale: { value: 260 - s.flakeSize * 230 },
    fFlakeTilt: { value: s.flakeTilt * 0.6 },
    fGlints: { value: s.glints },
    fRainbow: { value: s.rainbow },
    fSwirl: { value: 6 - s.swirl * 5.4 },
    fHue: { value: 120 + s.hue * 600 },
    fPastel: { value: s.pastel * 0.8 },
    fLines: { value: s.lines * 0.5 },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${FOIL_HEAD}`).replace('#include <opaque_fragment>', FOIL_MIX);
  };
  mat.customProgramCacheKey = () => 'coverforge-foil';
}

/** The printed artwork: paper, optionally under glossy film, with holo foil where the design has it. */
export function createSleeveMaterial(map: Texture, glossy: boolean, foil?: Foil | null): MeshPhysicalMaterial {
  const mat = new MeshPhysicalMaterial({
    map,
    roughness: glossy ? 0.22 : 0.75,
    clearcoat: glossy ? 1 : 0,
    clearcoatRoughness: 0.04,
  });
  if (foil) addFoil(mat, foil);
  return mat;
}

/** The unprinted body: translucent plastic, opaque plastic or card, depending on the template. */
export function createBodyMaterial(m: PreviewMaterial): MeshPhysicalMaterial {
  return new MeshPhysicalMaterial({
    color: m.color,
    roughness: m.roughness ?? 0.3,
    transmission: m.transmission ?? 0,
    thickness: m.transmission ? 1.2 : 0,
    ior: 1.5,
  });
}
