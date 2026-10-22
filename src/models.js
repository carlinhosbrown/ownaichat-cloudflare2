import {MODEL_SUGGESTIONS, chatModel} from '../public/models.js';
import {authorizationHeaders} from './connections.js';

const MODEL_ENDPOINTS = {
  deepseek:'https://api.deepseek.com/models',
  openai:'https://api.openai.com/v1/models',
  gemini:'https://generativelanguage.googleapis.com/v1beta/models',
  anthropic:'https://api.anthropic.com/v1/models'
};

export async function modelCatalog(provider, key, connection=null) {
  const suggestions=connection?.custom?[{id:connection.defaultModel,name:connection.defaultModel},...(connection.imageModel?[{id:connection.imageModel,name:connection.imageModel,kind:'image'}]:[])]:MODEL_SUGGESTIONS[provider];
  const configured=Boolean(key)||(connection?.custom&&connection.authType==='none');
  const fallback = warning => ({provider,models:suggestions,source:'suggested',configured,warning});
  if (!configured) return fallback('Añade tu API Key para consultar la lista del proveedor. Estos modelos son sugerencias.');
  const headers = connection?.custom?authorizationHeaders(connection,key):provider === 'anthropic' ? {'x-api-key':key,'anthropic-version':'2023-06-01'} : provider === 'gemini' ? {'x-goog-api-key':key} : {Authorization:`Bearer ${key}`};
  const models = new Map();
  let cursor = '';
  const visited = new Set();
  try {
    for (let page=0; page<5; page++) {
      const url = new URL(connection?.custom?connection.baseUrl+'/models':MODEL_ENDPOINTS[provider]);
      if (provider === 'gemini') {
        url.searchParams.set('pageSize','1000');
        if (cursor) url.searchParams.set('pageToken',cursor);
      }
      if (provider === 'anthropic') {
        url.searchParams.set('limit','1000');
        if (cursor) url.searchParams.set('after_id',cursor);
      }
      const response = await fetch(url,{headers,redirect:'manual',signal:AbortSignal.timeout(8000)});
      if (!response.ok) {
        const reason = response.status === 401 || response.status === 403 ? 'El proveedor no permite consultar los modelos con esta clave. Revisa su validez y permisos.' : response.status === 429 ? 'El proveedor ha limitado temporalmente las consultas de modelos.' : `No se pudo consultar el catálogo del proveedor (HTTP ${response.status}).`;
        return fallback(`${reason} Puedes usar las sugerencias o indicar un ID manualmente.`);
      }
      const body = await response.json();
      const entries = provider === 'gemini' ? body.models : body.data;
      if (!Array.isArray(entries)) throw new Error('Invalid catalog');
      for (const entry of entries) {
        if (!entry || typeof entry !== 'object') continue;
        const model = chatModel(provider,entry);
        if(model&&connection?.custom&&model.id===connection.imageModel)model.kind='image';
        if (model && models.size < 500) models.set(model.id,model);
      }
      cursor = provider === 'gemini' ? body.nextPageToken : provider === 'anthropic' && body.has_more ? body.last_id : '';
      if (!cursor || models.size >= 500) break;
      if (typeof cursor !== 'string' || cursor.length > 2048 || visited.has(cursor)) throw new Error('Invalid pagination');
      visited.add(cursor);
      if (page === 4) return {provider,models:[...models.values()],source:'api',configured:true,warning:'Lista parcial: el proveedor tiene más páginas. Puedes escribir otro ID manualmente.'};
    }
    if(connection?.custom)for(const model of suggestions)if(!models.has(model.id))models.set(model.id,model);
    if (!models.size) return fallback('La API no ha devuelto modelos reconocidos. Usa una sugerencia o un ID manual; la disponibilidad depende de tu cuenta.');
    return {provider,models:[...models.values()],source:'api',configured:true,warning:''};
  } catch {
    return fallback('No se pudo actualizar la lista de modelos. Puedes usar las sugerencias o indicar un ID manualmente.');
  }
}
