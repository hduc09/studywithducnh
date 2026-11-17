import {SUPABASE_URL,SUPABASE_ANON_KEY} from './config.js';

let clientPromise;
export const cloudConfigured=()=>/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(SUPABASE_URL)
  && SUPABASE_ANON_KEY.length>20;
export function cloudClient(){
  if(!cloudConfigured())return Promise.resolve(null);
  if(!clientPromise)clientPromise=import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0/+esm')
    .then(({createClient})=>createClient(SUPABASE_URL,SUPABASE_ANON_KEY,{
      auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
    })).catch(error=>{clientPromise=null;throw error});
  return clientPromise;
}
