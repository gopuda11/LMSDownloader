import {build} from 'esbuild';
import {mkdir,copyFile,readFile,writeFile,readdir} from 'node:fs/promises';
await build({entryPoints:['src/pdf-sandbox.js'],outfile:'vendor/pdf-sandbox.js',bundle:true,format:'iife',platform:'browser',minify:true,legalComments:'eof',define:{'process.env.NODE_ENV':'"production"'}});
await mkdir('vendor/licenses',{recursive:true});
// Preserve licenses for every installed production dependency, including transitive packages.
const lock=JSON.parse(await readFile('package-lock.json','utf8'));let notices='# Packaged third-party software\n\nAll rendering runs locally. Sources and exact versions are pinned in package-lock.json.\n\n';
for(const [key,value] of Object.entries(lock.packages)){
 if(!key||value.dev)continue;
 const name=key.replace(/^node_modules\//,'');const slug=name.replace(/[^\w.-]/g,'_');
 notices+=`- ${name} ${value.version}: ${value.license||'see included license'}, source ${value.resolved||'npm registry'}\n`;
 for(const file of await readdir(key)){if(/^(license|licence|copying|notice|third_party_notices)(\.|$)/i.test(file))await copyFile(`${key}/${file}`,`vendor/licenses/${slug}-${file}`);}
}
for(const f of await readdir('node_modules/@aiden0z/pptx-renderer/licenses'))await copyFile(`node_modules/@aiden0z/pptx-renderer/licenses/${f}`,`vendor/licenses/${f}`);
notices+='\nMPL-2.0 component mtx-decompressor is unmodified. Corresponding source: https://github.com/ChristopherVR/mtx-decompressor/tree/v1.4.2 . Its MPL terms remain in effect; see included notices and license.\n';
await writeFile('THIRD_PARTY_NOTICES.md',notices);
