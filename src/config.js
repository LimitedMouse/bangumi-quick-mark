const VERSION = '2.0.0';
const CREDIT = '© 复旦沸点技术组-风吟雨';
const TYPES = {anime:'动画',book:'书籍',game:'游戏',music:'音乐',real:'三次元'};
const SORTS = {rank:'排名',trends:'热度',collects:'收藏',date:'日期',title:'名称'};
const DONE = {anime:'看过',book:'读过',game:'玩过',music:'听过',real:'看过'};
const DEFAULTS = {
  score:7, ahead:8, behind:2, digits:true, wheel:'off', skipDone:false, confirmDelete:true,
  bindings:{back:'ArrowUp',skip:'ArrowDown,ArrowLeft',rate:'ArrowRight',remove:''},
  buttons:[{action:'skip',label:'跳过',visible:true},{action:'rate',label:'',visible:true},{action:'back',label:'上一部',visible:true},{action:'remove',label:'删除当前收藏',visible:true}]
};
const clone = value => JSON.parse(JSON.stringify(value));
function validateSettings(value) {
  const s={...clone(DEFAULTS),...value,bindings:{...DEFAULTS.bindings,...value?.bindings}};
  if(!Number.isInteger(s.score)||s.score<1||s.score>10) throw Error('默认评分应为 1–10');
  if(!Number.isInteger(s.ahead)||s.ahead<0||s.ahead>20||!Number.isInteger(s.behind)||s.behind<2||s.behind>10) throw Error('向前预加载为 0–20，保留前面为 2–10');
  if(!['off','alt','direct'].includes(s.wheel)) throw Error('滚轮设置无效');
  for(const name of ['digits','skipDone','confirmDelete']) if(typeof s[name]!=='boolean') throw Error('开关设置无效');
  const used=new Set();
  for(const action of ['back','skip','rate','remove']) {
    if(typeof s.bindings[action]!=='string') throw Error('快捷键格式无效');
    const keys=s.bindings[action].split(',').map(k=>k.trim()).filter(Boolean);
    for(const key of keys) {
      if(!/^(Arrow(Up|Down|Left|Right)|[a-zA-Z]|[0-9]|Delete|Backspace|Home|End|PageUp|PageDown)$/.test(key)) throw Error('键位仅支持方向键、单个字母、数字及导航键');
      const normalized=key.length===1?key.toLowerCase():key;
      if(used.has(normalized)||(s.digits&&/^\d$/.test(key))) throw Error('快捷键冲突：'+key);
      used.add(normalized);
    }
    s.bindings[action]=keys.map(k=>k.length===1?k.toLowerCase():k).join(',');
  }
  if(!Array.isArray(s.buttons)||s.buttons.length!==4||new Set(s.buttons.map(b=>b.action)).size!==4) throw Error('按钮配置无效');
  for(const b of s.buttons) if(!['back','skip','rate','remove'].includes(b.action)||typeof b.label!=='string'||b.label.length>30||typeof b.visible!=='boolean') throw Error('按钮配置无效');
  return s;
}
function listConfig(value) {
  const u=new URL(value,location.origin);
  if(!/^(bgm\.tv|bangumi\.tv|chii\.in)$/.test(u.hostname)) throw Error('只支持 Bangumi 列表地址');
  const match=u.pathname.match(/^\/(anime|book|game|music|real)\/browser(?:\/.*)?$/);
  if(!match) throw Error('请输入分类浏览页地址（例如 /anime/browser/?sort=rank）');
  const params=new URLSearchParams();
  for(const [key,val] of u.searchParams) if(['sort','orderby','year','month','type','platform','tag'].includes(key)) params.set(key,val);
  const sort=params.get('sort')||'rank';
  if(!SORTS[sort]) throw Error('不支持该排序');
  params.set('sort',sort); params.sort();
  return {type:match[1],sort,path:u.pathname.replace(/\/$/,'')+'/',query:params.toString()};
}
const listKey = c => c.path+'?'+c.query;
const defaultList=()=>listConfig('/anime/browser/?sort=rank');
function positionValid(s) {return s&&Number.isInteger(s.page)&&s.page>0&&Number.isInteger(s.index)&&s.index>=0&&(s.id===null||/^\d+$/.test(s.id));}
const freshPosition=()=>({page:1,index:0,id:null});
const keyLabel=k=>({ArrowUp:'↑',ArrowDown:'↓',ArrowLeft:'←',ArrowRight:'→'}[k]||k);
