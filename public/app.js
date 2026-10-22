const $ = selector => document.querySelector(selector);
const el = (name, className, text) => {const node=document.createElement(name);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
const MODEL_DEFAULTS={deepseek:'deepseek-chat',openai:'gpt-4.1-mini',gemini:'gemini-2.5-flash',anthropic:'claude-sonnet-4-5'};
const state={projects:[],chats:[],configured:[],attachments:{available:false,message:'Adjuntos desactivados.'},selectedProject:null,selectedChat:null,messages:[],provider:localStorage.getItem('oc.provider')||'deepseek',models:JSON.parse(localStorage.getItem('oc.models')||'{}'),editingProject:null,busy:false,setup:false};
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
  state.projects=p.projects;state.chats=c.chats;state.configured=k.configured;state.attachments=account.features.attachments;
  renderSidebar();renderContent();updateKeyStatus();
}
function applyModel(){const provider=state.provider in MODEL_DEFAULTS?state.provider:'deepseek';state.provider=provider;$('#provider-select').value=provider;$('#model-input').value=state.models[provider]||MODEL_DEFAULTS[provider];updateKeyStatus();}
function updateKeyStatus(){$('#key-status').textContent=state.configured.includes(state.provider)?'API Key configurada':'Configura tu API Key';}
$('#provider-select').addEventListener('change',()=>{state.provider=$('#provider-select').value;localStorage.setItem('oc.provider',state.provider);applyModel();});
$('#model-input').addEventListener('change',()=>{state.models[state.provider]=$('#model-input').value.trim();localStorage.setItem('oc.models',JSON.stringify(state.models));});
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
async function openChat(chatId){if(state.busy)return;try{const response=await data(`/api/chats/${chatId}`);state.selectedChat=chatId;state.selectedProject=response.chat.project_id;state.messages=response.messages;state.provider=response.chat.provider;state.models[state.provider]=response.chat.model;applyModel();renderSidebar();renderContent();scrollToBottom();}catch(e){toast(e.message);}}
async function deleteChat(c){if(state.busy)return;if(!confirm(`¿Eliminar la conversación «${c.title}»?`))return;try{await data(`/api/chats/${c.id}`,{method:'DELETE'});if(state.selectedChat===c.id){state.selectedChat=null;state.messages=[];}await refresh();}catch(e){toast(e.message);}}
function appendMessage(msg){const outer=el('article','message '+msg.role);if(msg.role==='assistant')outer.append(el('div','avatar','✦'));const body=el('div','message-content',msg.content);outer.append(body);$('#messages').append(outer);return body;}
function renderMessages(){const messages=$('#messages');messages.replaceChildren();for(const m of state.messages)appendMessage(m);scrollToBottom();}
function scrollToBottom(){$('#chat-view').scrollTop=$('#chat-view').scrollHeight;}
$('#prompt').addEventListener('input',()=>{const t=$('#prompt');t.style.height='auto';t.style.height=Math.min(t.scrollHeight,170)+'px';});
$('#prompt').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();$('#composer').requestSubmit();}});
for(const starter of document.querySelectorAll('.starter'))starter.addEventListener('click',()=>{$('#prompt').value=starter.dataset.prompt;$('#prompt').focus();});
$('#composer').addEventListener('submit',async event=>{
  event.preventDefault();if(state.busy)return;
  const prompt=$('#prompt').value.trim();if(!prompt)return;
  const provider=state.provider,model=$('#model-input').value.trim();
  if(!/^[\w.\-/:]{2,100}$/.test(model)||model.includes('://')||model.startsWith('/')){toast('Introduce un identificador de modelo válido.');return;}
  if(!state.configured.includes(provider)){openSettings();toast(`Primero añade la API Key de ${provider}.`);return;}
  state.busy=true;$('#send').disabled=true;$('#prompt').disabled=true;
  try {
    let chatId=state.selectedChat;
    if(!chatId){const created=await data('/api/chats',{method:'POST',body:{projectId:state.selectedProject,provider,model}});chatId=created.id;state.selectedChat=chatId;state.messages=[];$('#messages').replaceChildren();}
    $('#welcome').hidden=true;$('#project-view').hidden=true;$('#messages').hidden=false;
    state.messages.push({role:'user',content:prompt});appendMessage({role:'user',content:prompt});
    $('#prompt').value='';$('#prompt').style.height='auto';
    const bubble=appendMessage({role:'assistant',content:'Pensando…'});bubble.classList.add('typing');scrollToBottom();
    const resp=await request(`/api/chats/${chatId}/messages`,{method:'POST',body:{content:prompt,provider,model}});
    const reader=resp.body.getReader(),decoder=new TextDecoder();let streamBuffer='',answer='',errorMsg='';
    while(true){const {done,value}=await reader.read();if(done)break;streamBuffer+=decoder.decode(value,{stream:true});let pos;
      while((pos=streamBuffer.indexOf('\n'))>=0){const line=streamBuffer.slice(0,pos).trim();streamBuffer=streamBuffer.slice(pos+1);if(!line.startsWith('data:'))continue;try{const item=JSON.parse(line.slice(5));if(item.delta){answer+=item.delta;bubble.textContent=answer;bubble.classList.remove('typing');scrollToBottom();}if(item.error){errorMsg=item.error;}}catch{/* ignore malformed chunk */}}
    }
    if(errorMsg)throw new Error(errorMsg);
    if(answer){state.messages.push({role:'assistant',content:answer});}else throw new Error('El modelo no devolvió una respuesta.');
  }catch(error){toast(error.message);const last=$('#messages .message:last-child .message-content');if(last && last.classList.contains('typing')){last.textContent='No se pudo generar la respuesta. '+error.message;last.classList.remove('typing');}}
  finally{state.busy=false;$('#send').disabled=false;$('#prompt').disabled=false;try{const chats=await data('/api/chats');state.chats=chats.chats;renderSidebar();updateContext(state.chats.find(c=>c.id===state.selectedChat)?.title);}catch{}$('#prompt').focus();}
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
    if(state.configured.includes(provider)){const del=el('button','remove','Quitar');del.type='button';del.addEventListener('click',async()=>{if(!confirm(`¿Eliminar la API Key de ${name}?`))return;try{await data(`/api/providers/${provider}`,{method:'DELETE'});state.configured=state.configured.filter(x=>x!==provider);renderSettings();updateKeyStatus();}catch(e){toast(e.message);}});form.append(del);}
    form.addEventListener('submit',async e=>{e.preventDefault();save.disabled=true;try{await data(`/api/providers/${provider}`,{method:'PUT',body:{key:input.value}});if(!state.configured.includes(provider))state.configured.push(provider);renderSettings();updateKeyStatus();toast('API Key guardada de forma cifrada.');}catch(e){toast(e.message);}finally{save.disabled=false;}});card.append(form);list.append(card);
  }}
$('#export-btn').addEventListener('click',async()=>{try{const response=await request('/api/export');const blob=await response.blob();const url=URL.createObjectURL(blob);const a=el('a');a.href=url;a.download='ownchat-export-'+new Date().toISOString().slice(0,10)+'.json';a.click();URL.revokeObjectURL(url);}catch(e){toast(e.message);}});
$('#logout-btn').addEventListener('click',async()=>{try{await data('/api/logout',{method:'POST'});showAuth(true);mobileClose();}catch(e){toast(e.message);}});
window.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();state.selectedProject=null;newChat();mobileClose();}});
if('serviceWorker' in navigator && location.protocol==='https:')navigator.serviceWorker.register('/sw.js').catch(()=>{});
async function syncHistory(){if(document.hidden||$('#app').hidden||state.busy)return;try{await refresh();if(state.selectedChat)await openChat(state.selectedChat);}catch(error){toast(error.message);}}
window.addEventListener('focus',syncHistory);
document.addEventListener('visibilitychange',syncHistory);
boot();
