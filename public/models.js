export const MODEL_DEFAULTS = {
  deepseek:'deepseek-flash',
  openai:'gpt-4.1-mini',
  gemini:'gemini-2.5-flash',
  anthropic:'claude-sonnet-4-5'
};

export const MODEL_SUGGESTIONS = {
  deepseek:[
    {id:'deepseek-flash',name:'DeepSeek Flash'},
    {id:'deepseek-v4-pro',name:'DeepSeek Pro'}
  ],
  openai:[
    {id:'gpt-4.1-mini',name:'GPT-4.1 mini'},
    {id:'gpt-4.1',name:'GPT-4.1'},
    {id:'gpt-4.1-nano',name:'GPT-4.1 nano'},
    {id:'gpt-5',name:'GPT-5'},
    {id:'gpt-5-mini',name:'GPT-5 mini'},
    {id:'gpt-5-nano',name:'GPT-5 nano'},
    {id:'gpt-4o',name:'GPT-4o'},
    {id:'gpt-4o-mini',name:'GPT-4o mini'},
    {id:'o3',name:'o3'},
    {id:'o4-mini',name:'o4-mini'},
    {id:'gpt-image-1',name:'GPT Image 1',kind:'image'}
  ],
  gemini:[
    {id:'gemini-2.5-flash',name:'Gemini 2.5 Flash'},
    {id:'gemini-2.5-pro',name:'Gemini 2.5 Pro'},
    {id:'gemini-2.5-flash-lite',name:'Gemini 2.5 Flash-Lite'}
  ],
  anthropic:[
    {id:'claude-sonnet-4-5',name:'Claude Sonnet 4.5'},
    {id:'claude-haiku-4-5',name:'Claude Haiku 4.5'},
    {id:'claude-opus-4-1',name:'Claude Opus 4.1'}
  ]
};

export const validModel = name => typeof name === 'string' && /^[\w.\-/:]{2,100}$/.test(name) && !name.includes('://') && !name.startsWith('/');

export function chatModel(provider, model) {
  const modelId = provider === 'gemini' ? (typeof model.name==='string'?model.name.replace(/^models\//,''):'') : model.id;
  if (!validModel(modelId)) return null;
  if(provider==='openai'&&/^(gpt-image-|chatgpt-image-)/.test(modelId))return {id:modelId,name:modelId,kind:'image'};
  if(provider==='gemini'&&model.supportedGenerationMethods?.includes('generateContent')&&/^gemini-.*image/.test(modelId))return {id:modelId,name:typeof model.displayName==='string'?model.displayName.slice(0,120):modelId,kind:'image'};
  if (provider === 'openai') {
    const baseId = modelId.startsWith('ft:') ? modelId.split(':')[1] : modelId;
    if (!/^(gpt-|chatgpt-|o[1-9](?:-|$))/.test(baseId)) return null;
    if (/audio|realtime|transcribe|tts|search|codex|image|computer-use|embedding|moderation/i.test(baseId)) return null;
    if (/^(?:gpt-[5-9](?:\.\d+)?|o[1-9])-pro(?:-|$)|^o1-(?:preview|mini)(?:-|$)/.test(baseId)) return null;
  }
  if (provider === 'gemini' && (!model.supportedGenerationMethods?.includes('generateContent') || !modelId.startsWith('gemini-') || /image|tts|audio|live|robotics/i.test(modelId))) return null;
  if (provider === 'anthropic' && (model.lifecycle === 'retired' || !modelId.startsWith('claude-'))) return null;
  if (provider === 'deepseek' && Array.isArray(model.output_modalities) && !model.output_modalities.includes('text')) return null;
  const name = model.display_name || model.displayName || (provider === 'deepseek' && model.name) || modelId;
  return {id:modelId,name:typeof name === 'string' ? name.slice(0,120) : modelId};
}
