import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
const metadata=`// ==UserScript==
// @name         Bangumi 快速补标
// @namespace    local.bangumi.quickmark
// @version      ${pkg.version}
// @description  多分类顺序补标、数字键评分、可配置快捷键与滚轮、异步保存、快速删除收藏及进度恢复。
// @author       © 复旦沸点技术组-风吟雨
// @license      MIT
// @homepageURL  https://github.com/LimitedMouse/bangumi-quick-mark
// @supportURL   https://github.com/LimitedMouse/bangumi-quick-mark/issues
// @updateURL    https://raw.githubusercontent.com/LimitedMouse/bangumi-quick-mark/main/bangumi-quick-mark.user.js
// @downloadURL  https://raw.githubusercontent.com/LimitedMouse/bangumi-quick-mark/main/bangumi-quick-mark.user.js
// @match        https://bgm.tv/*
// @match        https://bangumi.tv/*
// @match        https://chii.in/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @run-at       document-end
// @noframes
// ==/UserScript==
`;
const modules=['config','storage','site','queue','ui','app'];
const license=await readFile(path.join(root,'LICENSE'),'utf8');
const source=metadata+'/*\n'+license+'*/\n(() => {\n"use strict";\n'+(await Promise.all(modules.map(async m=>'\n// Module: '+m+'\n'+await readFile(path.join(root,'src',m+'.js'),'utf8')))).join('\n')+'\n})();\n';
await writeFile(path.join(root,'bangumi-quick-mark.user.js'),source);
if(process.argv.includes('--release')){
 const dest=path.join(root,'release','bangumi-quick-mark-'+pkg.version);await mkdir(dest,{recursive:true});
 for(const file of ['bangumi-quick-mark.user.js','README.md','CHANGELOG.md','PRIVACY.md','LICENSE','install.html'])await copyFile(path.join(root,file),path.join(dest,file));
 await mkdir(path.join(dest,'docs'),{recursive:true});
 for(const file of ['panel.png','settings.png'])await copyFile(path.join(root,'docs',file),path.join(dest,'docs',file));
 await mkdir(path.join(dest,'docs','install'),{recursive:true});
 for(const file of ['tampermonkey-menu.png','launch-button.png','quick-mark-panel.png'])await copyFile(path.join(root,'docs','install',file),path.join(dest,'docs','install',file));
 console.log('Release: '+dest);
}
console.log('Built v'+pkg.version+' ('+Buffer.byteLength(source)+' bytes)');
