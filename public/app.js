import {MODEL_DEFAULTS, MODEL_SUGGESTIONS, validModel} from './models.js';
import {DEFAULT_GENERATION, EFFORT_LABELS, modelCapabilities} from './modes.js';

const $ = selector => document.querySelector(selector);
const el = (name, className, text) => {const node=document.createElement(name);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
const state={projects:[],chats:[],configured:[],catalogs:{},catalogVersions:{},customModels:{},attachments:{available:false,message:'Adjuntos desactivados.'},selectedProject:null,selectedChat:null,messages:[],provider:localStorage.getItem('oc.provider')||'deepseek',models:JSON.parse(localStorage.getItem('oc.models')||'{}'),editingProject:null,busy:false,setup:false};
const modelLoads=new Map();
Object.assign(state,{customProviders:[],generation:{...DEFAULT_GENERATION},lastTextModels:{},editingConnection:null});
const PROVIDER_NAMES={deepseek:'DeepSeek',openai:'OpenAI',gemini:'Google Gemini',anthropic:'Anthropic Claude'};
const currentConnection=()=>state.customProviders.find(connection=>connection.id===state.provider);
const suggestedModels=provider=>{const connection=state.customProviders.find(item=>item.id===provider);return connection?[{id:connection.defaultModel,name:connection.defaultModel},...(connection.imageModel?[{id:connection.imageModel,name:connection.imageModel,kind:'image'}]:[])]:MODEL_SUGGESTIONS[provider]||[];};
const capabilities=model=>modelCapabilities(state.provider,model||$('#model-input').value.trim(),currentConnection());
const availableModels=()=>state.catalogs[state.provider]?.models||suggestedModels(state.provider);
let toastTimer;
function toast(message){const box=$('#toast');box.textContent=message;box.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>box.hidden=true,3800);}
async function request(path, options={}) {
  const headers={'X-OwnChat-Request':'1',...options.headers};
  if(options.body && typeof options.body==='object' && !(options.body instanceof FormData)) {headers['Content-Type']='application/json';options.body=JSON.stringify(options.body);}
  const response=await fetch(path,{...options,headers,credentials:'same-origin',cache:'no-store'});
  if(!response.ok){let detail={};try{detail=await response.json();}catch{};if(response.status===401 && !path.includes('/login')) {showAuth(true);}throw new Error(detail.error||`Error ${response.status}`);}
  return response;
}
const data=async (url,opts) => (await request(url,opts)).json();
function showAuth(installed){$('#app').hidden=true;$('#auth').hidden=false;state.setup=!installed;$('#token-label').hidden=installed;$('#auth-subtitle').textContent=installed?'Introduce tu contraseña para acceder a tus conversaciones.':'Primera instalación: crea tu contraseña de administrador.';$('#auth-submit').textContent=installed?'Entrar en mi espacio':'Activar mi espacio privado';$('#auth-password').setAttribute('autocomplete',installed?'current-password':'new-password');$('#auth-error').textContent='';}
function showApp(){$('#auth').hidden=true;$('#app').hidden=false;applyModel();}
async function boot(){
  try {const info=await data('/api/status');state.attachments=info.features.attachments;showAuth(info.installed);$('#config-warning').hidden=info.ready;
    if(info.installed){try{await data('/api/me');showApp();await refresh();}catch{/* Login needed */}}
    if(!info.ready)$('#auth-submit').disabled=true;
    else $('#auth-submit').disabled=false;
  }catch(error){showAuth(true);$('#config-warning').hidden=false;$('#config-warning').textContent='No se puede iniciar la aplicación. '+error.message;$('#auth-submit').disabled=true;}
}
$('#auth-form').addEventListener('submit',async event=>{
  event.preventDefault();$('#auth-error').textContent='';$('#auth-submit').disabled=true;
  try {
    const password=$('#auth-password').value;
    await data(state.setup?'/api/setup':'/api/login',{method:'POST',body:state.setup?{password,token:$('#setup-token').value}:{password}});
    $('#auth-password').value='';$('#setup-token').value='';showApp();await refresh();
  }catch(error){$('#auth-error').textContent=error.message;}finally{$('#auth-submit').disabled=false;}
});
async function refresh(){
  const [p,c,k,account]=await Promise.all([data('/api/projects'),data('/api/chats'),data('/api/providers'),data('/api/me')]);
  state.projects=p.projects;state.chats=c.chats;state.configured=k.configured;state.customProviders=k.customProviders||[];state.attachments=account.features.attachments;
  renderSidebar();renderContent();applyModel();
}
function applyModel(){
  const select=$('#provider-select');select.replaceChildren();
  for(const [provider,name] of [...Object.entries(PROVIDER_NAMES),...state.customProviders.map(connection=>[connection.id,connection.name])]){const option=el('option','',name);option.value=provider;select.append(option);}
  if(![...select.options].some(option=>option.value===state.provider)){
    if(state.selectedChat){const missing=el('option','','Conexión eliminada');missing.value=state.provider;select.append(missing);}
    else state.provider='deepseek';
  }
  select.value=state.provider;$('#model-input').value=state.models[state.provider]||currentConnection()?.defaultModel||MODEL_DEFAULTS[state.provider]||'';
  renderModelPicker();updateKeyStatus();loadModels(state.provider);
}
function rememberModel(){const model=$('#model-input').value.trim();if(validModel(model)){state.models[state.provider]=model;localStorage.setItem('oc.models',JSON.stringify(state.models));}}
function renderModelPicker(){
  const provider=state.provider;
  const catalog=state.catalogs[provider];
  const models=catalog?.models||suggestedModels(provider);
  const current=$('#model-input').value;
  const select=$('#model-select');select.replaceChildren();
  for(const model of models){const option=el('option','',(model.kind==='image'?'Imagen · ':'')+(model.name===model.id?model.id:`${model.name} · ${model.id}`));option.value=model.id;select.append(option);}
  if(current&&!models.some(model=>model.id===current)){const saved=el('option','',`${current} (guardado)`);saved.value=current;select.append(saved);}
  const custom=el('option','','Otro modelo…');custom.value='__custom__';select.append(custom);
  select.value=state.customModels[provider]?'__custom__':current;
  $('#model-input').hidden=!state.customModels[provider];
  const status=$('#model-list-status');
  status.textContent=modelLoads.has(provider)?'Actualizando modelos…':catalog?.source==='api'?'Modelos de tu API':'Modelos sugeridos';
  status.title=catalog?.warning||(catalog?.source==='api'?'La disponibilidad y compatibilidad final dependen de tu cuenta y del modelo.':'Añade tu API Key para consultar los modelos del proveedor.');
  $('#model-refresh').disabled=state.busy||modelLoads.has(provider)||!state.configured.includes(provider);
  select.disabled=state.busy;$('#model-input').disabled=state.busy;$('#provider-select').disabled=state.busy;
  renderGeneration();
}
function selectOptions(selector,values,labels,selected){const target=$(selector);target.replaceChildren();for(const value of values){const option=el('option','',labels[value]||value);option.value=value;target.append(option);}target.value=selected;target.disabled=state.busy;}
function renderGeneration(){
  const supported=capabilities(),generation=state.generation;
  const imageModel=availableModels().find(model=>capabilities(model.id).kind==='image');
  if(supported.kind==='image')generation.mode='image';
  else if(generation.mode==='image'||generation.mode==='reasoning'&&!supported.levels.length||generation.mode==='direct'&&!supported.canDirect)generation.mode='auto';
  const modes=supported.kind==='image'?['auto','image']:['auto',...(supported.canDirect?['direct']:[]),...(supported.levels.length?['reasoning']:[]),...(imageModel?['image']:[])];
  selectOptions('#generation-mode',modes,{auto:'Automático',direct:'Sin razonamiento',reasoning:'Razonamiento',image:'Generar imagen'},generation.mode);
  if(!['auto',...supported.levels].includes(generation.effort))generation.effort='auto';
  if(!supported.qualities.includes(generation.quality))generation.quality=supported.qualities[0];
  if(!supported.sizes.includes(generation.size))generation.size=supported.sizes[0];
  selectOptions('#generation-effort',[...new Set(['auto',...supported.levels])],EFFORT_LABELS,generation.effort);
  selectOptions('#image-quality',supported.qualities,EFFORT_LABELS,generation.quality);
  selectOptions('#image-size',supported.sizes,{auto:'Automático'},generation.size);
  $('#effort-control').hidden=generation.mode!=='reasoning'||supported.reasoningStyle==='vllm';
  $('#quality-control').hidden=generation.mode!=='image'||supported.qualities.length<2;$('#size-control').hidden=generation.mode!=='image'||supported.sizes.length<2;
  $('#generation-hint').textContent=generation.mode==='image'?'Una imagen por petición. Puede tener coste en tu proveedor. Se guarda en tu historial privado, sin R2.':generation.mode==='reasoning'?'Solo se muestra la respuesta final. Más razonamiento puede aumentar el tiempo y el coste.':generation.mode==='direct'?'Se solicita desactivar el razonamiento cuando el modelo lo permite.':'Se respeta el comportamiento predeterminado del modelo. Los niveles dependen de su compatibilidad.';
  $('#prompt').placeholder=generation.mode==='image'?'Describe la imagen que quieres crear…':'Escribe un mensaje…';
}
$('#generation-mode').addEventListener('change',()=>{
  const mode=$('#generation-mode').value;
  if(mode==='image'&&capabilities().kind!=='image'){
    const image=availableModels().find(model=>capabilities(model.id).kind==='image');if(!image)return;
    state.lastTextModels[state.provider]=$('#model-input').value;$('#model-input').value=image.id;state.customModels[state.provider]=false;rememberModel();
  }else if(mode!=='image'&&capabilities().kind==='image'){
    const textModel=state.lastTextModels[state.provider]||availableModels().find(model=>capabilities(model.id).kind!=='image')?.id;
    if(!textModel){toast('Selecciona un modelo de texto para volver al chat.');renderGeneration();return;}
    $('#model-input').value=textModel;state.customModels[state.provider]=false;rememberModel();
  }
  state.generation.mode=mode;renderModelPicker();
});
for(const [selector,property] of [['#generation-effort','effort'],['#image-quality','quality'],['#image-size','size']])$(selector).addEventListener('change',()=>{state.generation[property]=$(selector).value;});
function invalidateModels(provider){delete state.catalogs[provider];state.catalogVersions[provider]=(state.catalogVersions[provider]||0)+1;modelLoads.delete(provider);}
async function loadModels(provider,force=false){
  if(!state.configured.includes(provider))return;
  if(!force&&state.catalogs[provider])return;
  if(!force&&modelLoads.has(provider))return modelLoads.get(provider);
  const version=state.catalogVersions[provider]||0;
  const loading=(async()=>{
    try{
      const catalog=await data(`/api/providers/${provider}/models`);
      if(version!==(state.catalogVersions[provider]||0)||!state.configured.includes(provider))return;
      state.catalogs[provider]=catalog;
      if(force&&catalog.warning)toast(catalog.warning);
    }catch(error){if(force)toast(error.message);}
    finally{if(modelLoads.get(provider)===loading)modelLoads.delete(provider);if(provider===state.provider)renderModelPicker();}
  })();
  modelLoads.set(provider,loading);if(provider===state.provider)renderModelPicker();return loading;
}
function updateKeyStatus(){$('#key-status').textContent=state.configured.includes(state.provider)?'API Key configurada':'Configura tu API Key';}
$('#provider-select').addEventListener('change',()=>{state.provider=$('#provider-select').value;state.generation={...DEFAULT_GENERATION};localStorage.setItem('oc.provider',state.provider);applyModel();});
$('#model-select').addEventListener('change',()=>{state.customModels[state.provider]=$('#model-select').value==='__custom__';if(!state.customModels[state.provider]){$('#model-input').value=$('#model-select').value;rememberModel();}renderModelPicker();if(state.customModels[state.provider])$('#model-input').focus();});
$('#model-input').addEventListener('change',()=>{rememberModel();renderModelPicker();});
$('#model-refresh').addEventListener('click',()=>loadModels(state.provider,true));
function mobileClose(){$('#sidebar').classList.remove('open');$('#mobile-shade').hidden=true;}
$('#sidebar-open').addEventListener('click',()=>{$('#sidebar').classList.add('open');$('#mobile-shade').hidden=false;});
$('#sidebar-close').addEventListener('click',mobileClose);$('#mobile-shade').addEventListener('click',mobileClose);
function navButton(text,symbol,selected,handler,onMore){const button=el('button','nav-item'+(selected?' selected':''));button.type='button';const icon=el('span','nav-icon',symbol);button.append(icon,el('span','nav-label',text));button.addEventListener('click',()=>{handler();mobileClose();});if(onMore){const more=el('button','item-more','···');more.type='button';more.title='Opciones';more.addEventListener('click',e=>{e.stopPropagation();onMore();});button.append(more);}return button;}
function renderSidebar(){
  const q=$('#search').value.toLowerCase().trim();const pl=$('#project-list'),cl=$('#chat-list');pl.replaceChildren();cl.replaceChildren();
  for(const p of state.projects.filter(x=>x.name.toLowerCase().includes(q))){pl.append(navButton(p.name,'▦',state.selectedProject===p.id && !state.selectedChat,()=>selectProject(p.id),()=>openProjectDialog(p)));}
  if(!pl.children.length)pl.append(el('p','placeholder-small',q?'Sin coincidencias':'Crea tu primer proyecto'));
  for(const c of state.chats.filter(x=>x.title.toLowerCase().includes(q))){cl.append(navButton(c.title,c.project_id?'▫':'◷',state.selectedChat===c.id,()=>openChat(c.id),()=>deleteChat(c)));}
  if(!cl.children.length)cl.append(el('p','placeholder-small',q?'Sin coincidencias':'Aún no hay conversaciones'));
}
$('#search').addEventListener('input',renderSidebar);
function updateContext(title){$('#context-title').textContent=title||'Conversación nueva';const project=state.projects.find(p=>p.id===state.selectedProject);$('#active-context').textContent=project?'▦ '+project.name:'Sin proyecto';}
function renderContent(){
  const welcome=$('#welcome'),proj=$('#project-view'),messages=$('#messages');
  welcome.hidden=Boolean(state.selectedChat||state.selectedProject);proj.hidden=!(state.selectedProject&&!state.selectedChat);messages.hidden=!state.selectedChat;
  if(state.selectedChat){const chat=state.chats.find(c=>c.id===state.selectedChat);updateContext(chat?.title);renderMessages();}
  else if(state.selectedProject){renderProject();updateContext(state.projects.find(p=>p.id===state.selectedProject)?.name);}
  else updateContext('Conversación nueva');
}
function newChat(){if(state.busy)return;state.selectedChat=null;state.messages=[];renderSidebar();renderContent();$('#prompt').focus();}
$('#new-chat').addEventListener('click',()=>{state.selectedProject=null;newChat();mobileClose();});
async function selectProject(projectId){if(state.busy)return;state.selectedProject=projectId;state.selectedChat=null;state.messages=[];renderSidebar();renderContent();}
async function openChat(chatId){if(state.busy)return;try{const response=await data(`/api/chats/${chatId}`);state.selectedChat=chatId;state.selectedProject=response.chat.project_id;state.messages=response.messages;state.provider=response.chat.provider;state.models[state.provider]=response.chat.model;state.generation={...DEFAULT_GENERATION,...response.chat.settings};state.customModels[state.provider]=false;applyModel();renderSidebar();renderContent();scrollToBottom();}catch(e){toast(e.message);}}
async function deleteChat(c){if(state.busy)return;if(!confirm(`¿Eliminar la conversación «${c.title}»?`))return;try{await data(`/api/chats/${c.id}`,{method:'DELETE'});if(state.selectedChat===c.id){state.selectedChat=null;state.messages=[];}await refresh();}catch(e){toast(e.message);}}
function fillMessage(body,msg){
  body.replaceChildren();body.append(el('div','message-text',msg.content||''));
  for(const image of msg.images||[]){if(!/^\/api\/images\/[a-f0-9-]{36}$/.test(image.url))continue;const picture=el('img','generated-image');picture.src=image.url;picture.alt='Imagen generada por IA';picture.loading='lazy';picture.addEventListener('load',scrollToBottom);const link=el('a','image-download','↓ Descargar imagen');link.href=image.url+'?download=1';link.download='';body.append(picture,link);}
  if(msg.role==='assistant'&&msg.settings?.mode&&msg.settings.mode!=='auto'){const settings=msg.settings;body.append(el('small','generation-badge',settings.mode==='image'?`Imagen · ${EFFORT_LABELS[settings.quality]||settings.quality||'Automático'}`:settings.mode==='direct'?'Sin razonamiento':`Razonamiento · ${EFFORT_LABELS[settings.effort]||'Automático'}`));}
}
function appendMessage(msg){const outer=el('article','message '+msg.role);if(msg.role==='assistant')outer.append(el('div','avatar','✦'));const body=el('div','message-content');fillMessage(body,msg);outer.append(body);$('#messages').append(outer);return body;}
function renderMessages(){const messages=$('#messages');messages.replaceChildren();for(const m of state.messages)appendMessage(m);scrollToBottom();}
function scrollToBottom(){$('#chat-view').scrollTop=$('#chat-view').scrollHeight;}
$('#prompt').addEventListener('input',()=>{const t=$('#prompt');t.style.height='auto';t.style.height=Math.min(t.scrollHeight,170)+'px';});
$('#prompt').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();$('#composer').requestSubmit();}});
for(const starter of document.querySelectorAll('.starter'))starter.addEventListener('click',()=>{$('#prompt').value=starter.dataset.prompt;$('#prompt').focus();});
$('#composer').addEventListener('submit',async event=>{
  event.preventDefault();if(state.busy)return;
  const prompt=$('#prompt').value.trim();if(!prompt)return;
  const provider=state.provider,model=$('#model-input').value.trim(),settings={...state.generation};
  if(!validModel(model)){toast('Introduce un identificador de modelo válido.');return;}
  if(!state.configured.includes(provider)){openSettings();toast(`Primero añade la API Key de ${provider}.`);return;}
  rememberModel();state.busy=true;$('#send').disabled=true;$('#prompt').disabled=true;renderModelPicker();
  try {
    let chatId=state.selectedChat;
    if(!chatId){const created=await data('/api/chats',{method:'POST',body:{projectId:state.selectedProject,provider,model,settings}});chatId=created.id;state.selectedChat=chatId;state.messages=[];$('#messages').replaceChildren();}
    $('#welcome').hidden=true;$('#project-view').hidden=true;$('#messages').hidden=false;
    state.messages.push({role:'user',content:prompt});appendMessage({role:'user',content:prompt});
    $('#prompt').value='';$('#prompt').style.height='auto';
    const bubble=appendMessage({role:'assistant',content:settings.mode==='image'?'Generando imagen…':'Pensando…'});bubble.classList.add('typing');scrollToBottom();
    const resp=await request(`/api/chats/${chatId}/messages`,{method:'POST',body:{content:prompt,provider,model,settings}});
    if(resp.headers.get('content-type')?.includes('application/json')){const result=await resp.json();state.messages.push(result.message);fillMessage(bubble,result.message);bubble.classList.remove('typing');scrollToBottom();return;}
    const reader=resp.body.getReader(),decoder=new TextDecoder();let streamBuffer='',answer='',errorMsg='';
    while(true){const {done,value}=await reader.read();if(done)break;streamBuffer+=decoder.decode(value,{stream:true});let pos;
      while((pos=streamBuffer.indexOf('\n'))>=0){const line=streamBuffer.slice(0,pos).trim();streamBuffer=streamBuffer.slice(pos+1);if(!line.startsWith('data:'))continue;try{const item=JSON.parse(line.slice(5));if(item.delta){answer+=item.delta;bubble.textContent=answer;bubble.classList.remove('typing');scrollToBottom();}if(item.error){errorMsg=item.error;}}catch{/* ignore malformed chunk */}}
    }
    if(errorMsg)throw new Error(errorMsg);
    if(answer){const message={role:'assistant',content:answer,settings};state.messages.push(message);fillMessage(bubble,message);}else throw new Error('El modelo no devolvió una respuesta.');
  }catch(error){toast(error.message);const last=$('#messages .message:last-child .message-content');if(last && last.classList.contains('typing')){last.textContent='No se pudo generar la respuesta. '+error.message;last.classList.remove('typing');}}
  finally{state.busy=false;$('#send').disabled=false;$('#prompt').disabled=false;renderModelPicker();try{const chats=await data('/api/chats');state.chats=chats.chats;renderSidebar();updateContext(state.chats.find(c=>c.id===state.selectedChat)?.title);}catch{}$('#prompt').focus();}
});
function renderProject(){const target=$('#project-view');target.replaceChildren();const project=state.projects.find(p=>p.id===state.selectedProject);if(!project)return;
  target.append(el('div','project-symbol','▦'),el('h1','',project.name),el('p','sub',state.attachments.available?'Las conversaciones de este proyecto comparten instrucciones y documentos de referencia.':'Las conversaciones de este proyecto comparten sus instrucciones.'));
  const tools=el('div','project-tools');const chatBtn=el('button','primary','＋ Nueva conversación');chatBtn.addEventListener('click',newChat);const editBtn=el('button','ghost-btn','Editar proyecto');editBtn.addEventListener('click',()=>openProjectDialog(project));const uploadBtn=el('button','ghost-btn','↑ Subir archivo');const deleteBtn=el('button','ghost-btn','Eliminar proyecto');deleteBtn.addEventListener('click',async()=>{if(!confirm(`¿Eliminar el proyecto «${project.name}» y sus archivos? Las conversaciones se conservarán sin proyecto.`))return;try{await data(`/api/projects/${project.id}`,{method:'DELETE'});state.selectedProject=null;state.selectedChat=null;state.messages=[];await refresh();toast('Proyecto eliminado.');}catch(e){toast(e.message);}});tools.append(chatBtn,editBtn,uploadBtn,deleteBtn);target.append(tools);
  uploadBtn.hidden=!state.attachments.available;
  const input=el('input');input.type='file';input.hidden=true;input.disabled=!state.attachments.available;input.accept='.txt,.md,.csv,.json,.pdf,.png,.jpg,.jpeg,.webp';uploadBtn.addEventListener('click',()=>input.click());input.addEventListener('change',async()=>{if(input.files[0]){const fd=new FormData();fd.append('file',input.files[0]);try{uploadBtn.disabled=true;await data(`/api/projects/${project.id}/files`,{method:'POST',body:fd});toast('Archivo añadido al proyecto.');await loadProjectFiles(project.id);}catch(e){toast(e.message);}finally{uploadBtn.disabled=false;}}});target.append(input);
  target.append(el('h3','', 'INSTRUCCIONES'));target.append(el('div','project-info',project.instructions||'Sin instrucciones. Puedes añadirlas en «Editar proyecto».'));
  target.append(el('h3','','ARCHIVOS DEL PROYECTO'));const files=el('div','file-list');files.id='current-files';target.append(files);
  target.append(el('p','sub',state.attachments.available?'Los archivos .txt, .md, .csv y .json de hasta 200 KB se leen como contexto. Los PDF e imágenes se almacenan para su descarga, pero aún no se interpretan en el chat.':state.attachments.message));
  loadProjectFiles(project.id);
}
async function loadProjectFiles(projectId){try{const response=await data(`/api/projects/${projectId}/files`);if(state.selectedProject!==projectId||state.selectedChat)return;const list=$('#current-files');if(!list)return;list.replaceChildren();state.attachments=response.attachments;if(!response.files.length){list.append(el('p','sub',response.attachments.available?'Todavía no has añadido archivos.':'No hay archivos en este proyecto.'));return;}
  for(const f of response.files){const row=el('div','file-row');row.append(el('span','',f.readable?'▤':'▣'));const link=el(response.attachments.available?'a':'span','',f.filename);if(response.attachments.available){link.href=`/api/files/${f.id}`;link.setAttribute('download',f.filename);link.title='Descargar archivo';}row.append(link,el('small','',Math.round(f.bytes/1024)+' KB'+(f.readable&&response.attachments.available?' · IA':'')));const rm=el('button','','×');rm.title='Eliminar archivo';rm.disabled=!response.attachments.available;rm.addEventListener('click',async()=>{if(!confirm('¿Eliminar este archivo?'))return;try{await data(`/api/files/${f.id}`,{method:'DELETE'});await loadProjectFiles(projectId);}catch(e){toast(e.message);}});row.append(rm);list.append(row);}
}catch(e){toast(e.message);}}
function openProjectDialog(project=null){state.editingProject=project?.id||null;$('#project-dialog-title').textContent=project?'Editar proyecto':'Nuevo proyecto';$('#project-name').value=project?.name||'';$('#project-instructions').value=project?.instructions||'';$('#project-dialog').showModal();}
$('#add-project').addEventListener('click',()=>openProjectDialog());
$('#project-dialog-close').addEventListener('click',()=>$('#project-dialog').close());$('#project-cancel').addEventListener('click',()=>$('#project-dialog').close());
$('#project-form').addEventListener('submit',async e=>{e.preventDefault();const body={name:$('#project-name').value,instructions:$('#project-instructions').value};try{if(state.editingProject){await data(`/api/projects/${state.editingProject}`,{method:'PATCH',body});}else{const result=await data('/api/projects',{method:'POST',body});state.selectedProject=result.id;state.selectedChat=null;}$('#project-dialog').close();await refresh();}catch(e){toast(e.message);}});
function openSettings(){renderSettings();$('#settings-dialog').showModal();}
$('#settings-btn').addEventListener('click',openSettings);$('#top-settings').addEventListener('click',openSettings);
function renderSettings(){const list=$('#providers-list');list.replaceChildren();for(const [provider,name] of Object.entries({deepseek:'DeepSeek',openai:'OpenAI',gemini:'Google Gemini',anthropic:'Anthropic Claude'})){
    const card=el('div','provider-card'),head=el('div','provider-head');head.append(el('strong','',name),el('small','',state.configured.includes(provider)?'✓ Configurada':'Sin clave'));card.append(head);
    const form=el('form');const input=el('input');input.type='password';input.placeholder='Pega tu API Key';input.autocomplete='off';input.required=true;const save=el('button','','Guardar');save.type='submit';form.append(input,save);
    if(state.configured.includes(provider)){const del=el('button','remove','Quitar');del.type='button';del.addEventListener('click',async()=>{if(!confirm(`¿Eliminar la API Key de ${name}?`))return;try{await data(`/api/providers/${provider}`,{method:'DELETE'});state.configured=state.configured.filter(x=>x!==provider);invalidateModels(provider);renderSettings();updateKeyStatus();renderModelPicker();}catch(e){toast(e.message);}});form.append(del);}
    form.addEventListener('submit',async e=>{e.preventDefault();save.disabled=true;try{await data(`/api/providers/${provider}`,{method:'PUT',body:{key:input.value}});if(!state.configured.includes(provider))state.configured.push(provider);invalidateModels(provider);renderSettings();updateKeyStatus();loadModels(provider);toast('API Key guardada de forma cifrada.');}catch(e){toast(e.message);}finally{save.disabled=false;}});card.append(form);list.append(card);
  }renderConnections();}
function renderConnections(){const list=$('#connections-list');list.replaceChildren();for(const connection of state.customProviders){const card=el('div','provider-card'),head=el('div','provider-head');head.append(el('strong','',connection.name),el('small','',connection.authType==='none'?'Sin clave':'✓ Cifrada'));card.append(head,el('p','connection-endpoint',connection.baseUrl),el('p','connection-note',connection.defaultModel));const actions=el('div','connection-actions'),edit=el('button','ghost-btn','Editar'),remove=el('button','ghost-btn','Eliminar');edit.type=remove.type='button';edit.addEventListener('click',()=>openConnection(connection));remove.addEventListener('click',async()=>{if(!confirm(`¿Eliminar «${connection.name}»? Su historial se conserva.`))return;try{await data(`/api/connections/${connection.id}`,{method:'DELETE'});invalidateModels(connection.id);await refresh();renderSettings();}catch(error){toast(error.message);}});actions.append(edit,remove);card.append(actions);list.append(card);}if(!state.customProviders.length)list.append(el('p','connection-note','Todavía no hay conexiones personalizadas.'));}
function connectionHints(){const kind=$('#connection-kind').value;$('#connection-help').textContent=kind==='runpod-serverless'?'URL: https://api.runpod.ai/v2/ENDPOINT_ID/openai/v1 · Requiere un worker vLLM compatible; usa la clave de RunPod.':kind==='runpod-pod'?'URL: https://POD_ID-8000.proxy.runpod.net/v1 · Expón el puerto HTTP del servidor de modelos. La clave es la del servidor, si la requiere.':'URL del servidor hasta /v1 (o la base equivalente), sin /chat/completions. El servidor debe admitir chat en streaming SSE.';$('#connection-key-label').hidden=$('#connection-auth').value==='none';$('#connection-key').required=$('#connection-auth').value==='bearer'&&!state.editingConnection;$('#connection-levels-label').hidden=!['openai','deepseek'].includes($('#connection-reasoning').value);}
function openConnection(connection=null){state.editingConnection=connection?.id||null;$('#connection-title').textContent=connection?'Editar conexión':'Nueva conexión';$('#connection-name').value=connection?.name||'';$('#connection-kind').value=connection?.kind||'openai';$('#connection-url').value=connection?.baseUrl||'';$('#connection-model').value=connection?.defaultModel||'';$('#connection-image').value=connection?.imageModel||'';$('#connection-auth').value=connection?.authType||'bearer';$('#connection-key').value='';$('#connection-reasoning').value=connection?.reasoningStyle||'none';$('#connection-levels').value=(connection?.effortLevels||[]).join(',');$('#connection-error').textContent='';connectionHints();$('#connection-dialog').showModal();}
$('#add-connection').addEventListener('click',()=>openConnection());
for(const selector of ['#connection-close','#connection-cancel'])$(selector).addEventListener('click',()=>$('#connection-dialog').close());
for(const selector of ['#connection-kind','#connection-auth','#connection-reasoning'])$(selector).addEventListener('change',connectionHints);
$('#connection-form').addEventListener('submit',async event=>{event.preventDefault();$('#connection-save').disabled=true;$('#connection-error').textContent='';const body={name:$('#connection-name').value,kind:$('#connection-kind').value,baseUrl:$('#connection-url').value,defaultModel:$('#connection-model').value.trim(),imageModel:$('#connection-image').value.trim(),authType:$('#connection-auth').value,key:$('#connection-key').value,reasoningStyle:$('#connection-reasoning').value,effortLevels:$('#connection-levels').value.split(',').map(level=>level.trim()).filter(Boolean)};try{const result=await data(state.editingConnection?`/api/connections/${state.editingConnection}`:'/api/connections',{method:state.editingConnection?'PUT':'POST',body});invalidateModels(result.id);$('#connection-key').value='';$('#connection-dialog').close();state.provider=result.id;state.models[result.id]=body.defaultModel;state.generation={...DEFAULT_GENERATION};await refresh();renderSettings();toast('Conexión guardada. Seleccionada para tu próximo mensaje.');}catch(error){$('#connection-error').textContent=error.message;}finally{$('#connection-save').disabled=false;}});
$('#export-btn').addEventListener('click',async()=>{try{const response=await request('/api/export');const blob=await response.blob();const url=URL.createObjectURL(blob);const a=el('a');a.href=url;a.download='ownchat-export-'+new Date().toISOString().slice(0,10)+'.json';a.click();URL.revokeObjectURL(url);}catch(e){toast(e.message);}});
$('#logout-btn').addEventListener('click',async()=>{try{await data('/api/logout',{method:'POST'});showAuth(true);mobileClose();}catch(e){toast(e.message);}});
window.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();state.selectedProject=null;newChat();mobileClose();}});
if('serviceWorker' in navigator && location.protocol==='https:')navigator.serviceWorker.register('/sw.js').catch(()=>{});
async function syncHistory(){if(document.hidden||$('#app').hidden||state.busy)return;try{await refresh();if(state.selectedChat)await openChat(state.selectedChat);}catch(error){toast(error.message);}}
window.addEventListener('focus',syncHistory);
document.addEventListener('visibilitychange',syncHistory);
boot();
