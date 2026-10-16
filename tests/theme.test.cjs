/* eslint-disable @typescript-eslint/no-require-imports -- Policy and real CSS contrast checks. */
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),postcss=require('postcss');
const {sourceLoader}=require('./helpers/source-loader.cjs');
const {themePalettes,normalizeTheme,isThemePalette,isThemeMode}=sourceLoader()('src/lib/theme.ts');
test('theme values are allowlisted and invalid/stale preferences fall back safely',()=>{
 assert.deepEqual(normalizeTheme('<script>','invalid'),{palette:'blue',mode:'light'});
 for(const p of themePalettes){assert.equal(isThemePalette(p.id),true);for(const mode of ['light','dark'])assert.deepEqual(normalizeTheme(p.id,mode),{palette:p.id,mode});}
 assert.equal(isThemePalette('red; color:white'),false);assert.equal(isThemeMode('auto'),false);
});
const css=postcss.parse(fs.readFileSync('src/app/themes.css','utf8'));
function rgb(hex){if(hex.length===4)hex='#'+[...hex.slice(1)].map(x=>x+x).join('');return [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));}
function luminance(c){return c.map(x=>x/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((n,x,i)=>n+x*[.2126,.7152,.0722][i],0);}
function contrast(a,b){const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
test('all ten palettes/modes meet text contrast for surfaces, buttons and semantic statuses',()=>{
 for(const p of themePalettes)for(const mode of ['light','dark']){
  const vars={};css.walkRules(rule=>{if(rule.selector===':root'||rule.selector===`:root[data-palette="${p.id}"]`||mode==='dark'&&rule.selector===':root[data-mode="dark"]')rule.walkDecls(d=>{if(d.prop.startsWith('--'))vars[d.prop]=d.value;});});
  const resolve=key=>{let v=vars[key];assert.ok(v,`${key} exists`);v=v.replace(/var\((--[\w-]+)\)/g,(_,n)=>resolve(n)).replace(/\bwhite\b/g,'#ffffff').replace(/\bblack\b/g,'#000000');const m=v.match(/^color-mix\(in srgb, (#[a-f\d]+) ([\d.]+)%, (#[a-f\d]+)\)$/i);if(m){const a=rgb(m[1]),b=rgb(m[3]),w=Number(m[2])/100;return '#'+a.map((x,i)=>Math.round(x*w+b[i]*(1-w)).toString(16).padStart(2,'0')).join('');}return v;};
  const pairs=[['foreground','surface'],['foreground','field-surface'],['muted','surface'],['primary-strong','surface-blue'],['primary','surface'],['on-strong','button-bg'],['danger-text','danger-soft'],['success-text','success-soft'],['warning-text','warning-soft'],['info-text','info-soft']];
  for(const [fg,bg]of pairs){const ratio=contrast(rgb(resolve('--'+fg)),rgb(resolve('--'+bg)));assert.ok(ratio>=4.5,`${p.id}/${mode} ${fg}/${bg}: ${ratio.toFixed(2)}`);}
 }
});
