// GLSL for the star-system view. Simplex noise: Ashima Arts / Stefan Gustavson (MIT).
export const NOISE = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+10.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0);
  const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy));
  vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);
  vec3 l=1.0-g;
  vec3 i1=min(g.xyz,l.zxy);
  vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;
  vec3 x2=x0-i2+C.yyy;
  vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857;
  vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z);
  vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy;
  vec4 y=y_*ns.x+ns.yyyy;
  vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);
  vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0;
  vec4 s1=floor(b1)*2.0+1.0;
  vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;
  vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);
  vec3 p1=vec3(a0.zw,h.y);
  vec3 p2=vec3(a1.xy,h.z);
  vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(0.5-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);
  m=m*m;
  return 105.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
float fbm(vec3 p){float a=0.5,s=0.0;for(int i=0;i<5;i++){s+=a*snoise(p);p*=2.03;a*=0.5;}return s;}
`;

const SURFACE_VERT = /* glsl */ `
varying vec3 vObj; varying vec3 vN; varying vec3 vPosW;
void main(){
  vObj=position;
  vN=normalize(mat3(modelMatrix)*normal);
  vec4 w=modelMatrix*vec4(position,1.0);
  vPosW=w.xyz;
  gl_Position=projectionMatrix*viewMatrix*w;
}`;

export const STAR = {
  vertex: SURFACE_VERT,
  fragment: /* glsl */ `
uniform float uTime; uniform vec3 uColor; uniform vec3 uHot;
varying vec3 vObj; varying vec3 vN; varying vec3 vPosW;
${NOISE}
void main(){
  vec3 p=normalize(vObj);
  float n=fbm(p*2.6+vec3(0.0,uTime*0.025,uTime*0.018));
  float g=snoise(p*22.0+vec3(uTime*0.12));
  float mu=max(dot(normalize(vN),normalize(cameraPosition-vPosW)),0.0);
  vec3 col=mix(uColor,uHot,pow(mu,0.7));
  col*=1.25+0.55*n+0.18*g;
  col*=0.55+0.45*pow(mu,0.35);
  gl_FragColor=vec4(col*2.4,1.0);
}`,
};

export const PLANET = {
  vertex: SURFACE_VERT,
  fragment: /* glsl */ `
uniform vec3 uStar; uniform vec3 uA; uniform vec3 uB; uniform vec3 uC; uniform vec3 uAtmo; uniform vec3 uCity;
uniform float uKind; uniform float uSeed; uniform float uCap; uniform float uTime; uniform float uTiles;
varying vec3 vObj; varying vec3 vN; varying vec3 vPosW;
${NOISE}
void main(){
  vec3 p=normalize(vObj);
  vec3 q=p*2.1+vec3(uSeed);
  float n=fbm(q);
  float h=n*0.5+0.5;
  vec3 col;
  if(uKind<0.5){ // rock
    float r=fbm(q*3.0)*0.5+0.5;
    col=mix(uA,uB,smoothstep(0.32,0.62,h));
    col=mix(col,uC,smoothstep(0.66,0.82,h)*0.8);
    col*=0.85+0.3*r;
  } else if(uKind<1.5){ // ice
    float cr=abs(snoise(q*5.0));
    col=mix(uA,uB,smoothstep(0.25,0.6,h));
    col=mix(col,uC,smoothstep(0.55,0.75,h+abs(p.y)*0.35));
    col=mix(col,uA*0.7,smoothstep(0.06,0.0,cr)*0.6);
  } else if(uKind<2.5){ // gas
    float w=fbm(vec3(p.x*2.0,p.y*9.0,p.z*2.0)+vec3(uSeed,0.0,uTime*0.01));
    float bands=sin(p.y*16.0+w*3.2)*0.5+0.5;
    col=mix(uA,uB,bands);
    col=mix(col,uC,smoothstep(0.55,0.95,sin(p.y*41.0+w*5.0)*0.5+0.5)*0.35);
  } else if(uKind<3.5){ // lava
    float cr=1.0-abs(snoise(q*3.5));
    col=mix(uA,uB,smoothstep(0.3,0.7,h)*0.6);
    float glow=pow(smoothstep(0.86,0.99,cr),2.0);
    col+=uC*glow*2.2;
  } else if(uKind<4.5){ // ocean
    col=h<0.52?mix(uA*0.6,uA,h/0.52):mix(uB,uC,smoothstep(0.62,0.8,h));
  } else { // moon
    float c=fbm(q*4.0);
    col=mix(uA,uB,smoothstep(-0.2,0.5,n));
    col=mix(col,uC,smoothstep(0.45,0.6,c)*0.5);
    float pit=smoothstep(0.55,0.62,abs(snoise(q*7.0)));
    col*=1.0-pit*0.25;
  }
  // the built-up pad where the city stands: a smooth plate with faint grid lines
  float cap=smoothstep(uCap-0.06,uCap+0.02,p.y);
  // hexagonal floor tiles, laid out from the city's middle
  vec2 u=p.xz/(1.0+max(p.y,0.0))*uTiles;
  const vec2 S=vec2(1.0,1.7320508);
  vec2 ha=mod(u,S)-S*0.5; vec2 hb=mod(u-S*0.5,S)-S*0.5;
  vec2 hc=dot(ha,ha)<dot(hb,hb)?ha:hb;
  vec2 id=u-hc;
  vec2 ah=abs(hc);
  float edge=0.5-max(dot(ah,normalize(S)),ah.x);
  float grid=1.0-smoothstep(0.0,0.035,edge);
  float tile=fract(sin(dot(id,vec2(127.1,311.7)))*43758.5453);
  vec3 pad=mix(vec3(0.12,0.135,0.17),vec3(0.2,0.225,0.27),tile)*(0.9+0.2*h);
  col=mix(col,pad,cap*0.7);
  float rim=smoothstep(0.0,0.02,abs(p.y-uCap));

  vec3 N=normalize(vN);
  vec3 L=normalize(uStar-vPosW);
  vec3 V=normalize(cameraPosition-vPosW);
  float nl=dot(N,L);
  float day=smoothstep(-0.12,0.55,nl);
  vec3 lit=col*(0.07+1.1*day*max(nl,0.0)+0.08*day);
  // the base plate's own lights: grid lines and its edge, faint by day, clear at night
  float nightish=1.0-smoothstep(-0.3,0.4,nl);
  lit+=uCity*(grid*cap*(0.015+0.05*nightish)+(1.0-rim)*0.45);
  if(uKind>3.5&&uKind<4.5&&h<0.52){ vec3 H=normalize(L+V); lit+=pow(max(dot(N,H),0.0),60.0)*0.6*day; }
  // city lights on the night side
  float night=1.0-smoothstep(-0.2,0.12,nl);
  float sparks=smoothstep(0.82,0.97,snoise(p*95.0+uSeed))*cap;
  lit+=vec3(1.0,0.82,0.55)*sparks*night*0.9;
  float fres=pow(1.0-max(dot(N,V),0.0),3.0);
  lit+=uAtmo*fres*(0.08+0.9*smoothstep(-0.25,0.6,nl))*0.9;
  gl_FragColor=vec4(lit,1.0);
}`,
};

export const ATMO = {
  vertex: /* glsl */ `
varying vec3 vPosW; varying vec3 vCenter; varying float vRs;
void main(){
  vec4 w=modelMatrix*vec4(position,1.0); vPosW=w.xyz;
  vCenter=(modelMatrix*vec4(0.0,0.0,0.0,1.0)).xyz;
  vRs=length(modelMatrix[0].xyz);
  gl_Position=projectionMatrix*viewMatrix*w;
}`,
  fragment: /* glsl */ `
uniform vec3 uColor; uniform vec3 uStar; uniform float uInner;
varying vec3 vPosW; varying vec3 vCenter; varying float vRs;
void main(){
  vec3 rd=normalize(vPosW-cameraPosition);
  vec3 oc=vCenter-cameraPosition;
  float t=dot(oc,rd);
  vec3 pt=cameraPosition+rd*t;
  float d=length(pt-vCenter);
  float rp=vRs*uInner;
  float x=clamp((vRs-d)/(vRs-rp),0.0,1.0);
  float i=pow(x,3.0)+0.35*pow(x,12.0);
  vec3 n=normalize(pt-vCenter);
  float day=smoothstep(-0.4,0.5,dot(n,normalize(uStar-pt)));
  gl_FragColor=vec4(uColor*i*(0.06+0.95*day),1.0);
}`,
};

export const SHELL = {
  vertex: /* glsl */ `
attribute float aIdx; attribute vec3 aBary;
varying float vIdx; varying vec3 vBary; varying vec3 vNW; varying vec3 vPosW;
void main(){
  vIdx=aIdx; vBary=aBary;
  vNW=normalize(mat3(modelMatrix)*normal);
  vec4 w=modelMatrix*vec4(position,1.0); vPosW=w.xyz;
  gl_Position=projectionMatrix*viewMatrix*w;
}`,
  fragment: /* glsl */ `
uniform float uCount; uniform vec3 uColor; uniform float uTime;
varying float vIdx; varying vec3 vBary; varying vec3 vNW; varying vec3 vPosW;
void main(){
  float e=min(vBary.x,min(vBary.y,vBary.z));
  float border=1.0-smoothstep(0.0,0.07,e);
  float facing=gl_FrontFacing?1.0:0.4;
  vec3 V=normalize(cameraPosition-vPosW);
  float graze=pow(1.0-abs(dot(normalize(vNW),V)),2.0);
  if(vIdx<uCount){
    float age=uCount-vIdx;
    float fresh=age<16.0?(1.0-age/16.0)*(0.6+0.4*sin(uTime*4.0+vIdx)):0.0;
    float sheen=0.5+0.5*sin(vIdx*12.9898+uTime*0.4);
    vec3 c=uColor*(0.10+0.06*sheen+0.35*graze+1.25*border+1.6*fresh);
    gl_FragColor=vec4(c*facing,1.0);
  } else {
    gl_FragColor=vec4(uColor*border*(0.05+0.12*graze)*facing,1.0);
  }
}`,
};

export const BELT = {
  vertex: /* glsl */ `
attribute float aS; attribute float aT; attribute vec3 aCol; attribute float aDen;
varying float vS; varying float vT; varying vec3 vCol; varying float vDen;
void main(){
  vS=aS; vT=aT; vCol=aCol; vDen=aDen;
  gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
}`,
  fragment: /* glsl */ `
uniform float uTime; uniform float uSpeed;
varying float vS; varying float vT; varying vec3 vCol; varying float vDen;
void main(){
  float a=1.0-abs(vT);
  float ph=fract(vS*vDen*4.0-uTime*uSpeed);
  float d=smoothstep(0.78,0.96,ph)*(1.0-smoothstep(0.96,1.0,ph));
  vec3 c=vCol*(0.7*a+5.0*d*a*a);
  gl_FragColor=vec4(c,1.0);
}`,
};

export const RING = {
  vertex: /* glsl */ `
varying vec2 vP;
void main(){ vP=position.xy; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragment: /* glsl */ `
uniform vec3 uColor; uniform float uInner; uniform float uOuter; uniform float uSeed;
varying vec2 vP;
${NOISE}
void main(){
  float r=(length(vP)-uInner)/(uOuter-uInner);
  float b=0.5+0.5*snoise(vec3(r*38.0,uSeed,0.0));
  float edge=smoothstep(0.0,0.08,r)*smoothstep(1.0,0.85,r);
  float gap=smoothstep(0.42,0.45,r)*smoothstep(0.52,0.49,r);
  float a=edge*(0.25+0.75*b)*(1.0-gap*0.85);
  gl_FragColor=vec4(uColor*a*0.55,1.0);
}`,
};

export const STARS = {
  vertex: /* glsl */ `
attribute float aSize; attribute vec3 aCol; attribute float aPh;
uniform float uTime; uniform float uDpr;
varying vec3 vCol; varying float vTw;
void main(){
  vCol=aCol;
  vTw=0.75+0.25*sin(uTime*(0.6+aPh)+aPh*20.0);
  vec4 mv=modelViewMatrix*vec4(position,1.0);
  gl_PointSize=aSize*uDpr;
  gl_Position=projectionMatrix*mv;
}`,
  fragment: /* glsl */ `
varying vec3 vCol; varying float vTw;
void main(){
  vec2 d=gl_PointCoord-0.5; float r=length(d);
  float core=smoothstep(0.5,0.0,r);
  float a=pow(core,2.2);
  gl_FragColor=vec4(vCol*a*vTw,1.0);
}`,
};

export const SKY = {
  // the nebula is low-frequency: computed per vertex of a dense sphere, not per pixel
  vertex: /* glsl */ `
varying vec3 vCol;
${NOISE}
void main(){
  vec3 d=normalize(position);
  float band=exp(-pow(dot(d,normalize(vec3(0.15,1.0,0.35)))*3.2,2.0));
  float n=fbm(d*2.2+vec3(3.1));
  float m=fbm(d*4.5+vec3(7.7));
  vec3 base=vec3(0.006,0.009,0.02);
  vec3 violet=vec3(0.10,0.035,0.16)*smoothstep(-0.1,0.7,n);
  vec3 teal=vec3(0.02,0.09,0.11)*smoothstep(0.0,0.8,m);
  vCol=base+(violet+teal)*(0.35+0.9*band)+vec3(0.05,0.045,0.06)*band*smoothstep(-0.3,0.6,n);
  vec4 p=projectionMatrix*modelViewMatrix*vec4(position,1.0); gl_Position=p.xyww;
}`,
  fragment: /* glsl */ `
varying vec3 vCol;
void main(){ gl_FragColor=vec4(vCol,1.0); }`,
};
