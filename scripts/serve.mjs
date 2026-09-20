import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=new URL('../',import.meta.url);
const files={'/':'install.html','/install.html':'install.html','/bangumi-quick-mark.user.js':'bangumi-quick-mark.user.js','/README.md':'README.md','/PRIVACY.md':'PRIVACY.md','/CHANGELOG.md':'CHANGELOG.md','/LICENSE':'LICENSE'};
http.createServer(async(req,res)=>{
 const file=files[new URL(req.url,'http://127.0.0.1').pathname];
 if(!file||req.method!=='GET'){res.writeHead(404);res.end('Not found');return;}
 try{const data=await readFile(fileURLToPath(new URL(file,root)));res.writeHead(200,{'Content-Type':file.endsWith('.js')?'application/javascript; charset=utf-8':file.endsWith('.html')?'text/html; charset=utf-8':'text/plain; charset=utf-8','Cache-Control':'no-store'});res.end(data);}catch{res.writeHead(500);res.end('Unavailable');}
}).listen(8787,'127.0.0.1',()=>console.log('Install: http://127.0.0.1:8787/install.html'));
