import { getChatGPTUser } from '../../chatgpt-auth';
import { readLedger, saveLedger } from '../../../db/ledger-store';
import { applyCommand, check, integer, type Command } from '../../../lib/ledger';
export const dynamic='force-dynamic';
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
export async function GET() { const user=await getChatGPTUser();if(!user)return reply({error:'请先登录'},401);try { return reply({...await readLedger(user.userId),user:{name:user.displayName,email:user.email}}); }catch { return reply({error:'账本暂时无法载入，请稍后重试'},503); } }
export async function POST(request:Request) {const user=await getChatGPTUser();if(!user)return reply({error:'请先登录'},401);
 const origin=request.headers.get('origin');if(!origin||origin!==new URL(request.url).origin)return reply({error:'请从本站提交操作'},403);
 if(!request.headers.get('content-type')?.startsWith('application/json'))return reply({error:'请求格式无效'},415);
 try { const raw=await request.text();check(raw.length<40000,'提交内容过大');const input=JSON.parse(raw);const revision=integer(input.revision,0,Number.MAX_SAFE_INTEGER,'账本版本');check(typeof input.requestId==='string'&&input.requestId.length>=8&&input.requestId.length<=100,'请求编号无效');const snapshot=await readLedger(user.userId);
 if(snapshot.state.requests.includes(input.requestId))return reply(snapshot);
 if(snapshot.revision!==revision)return reply({error:'其他设备已更新账本，已载入最新数据。请核对后再次提交。',...snapshot},409);
 const next=applyCommand(snapshot.state,input.command as Command,input.requestId);
 if(!await saveLedger(user.userId,revision,next)){const latest=await readLedger(user.userId);if(latest.state.requests.includes(input.requestId))return reply(latest);return reply({error:'账本同时发生变更，请刷新后重试',...latest},409);}
 return reply({state:next,revision:revision+1});
 }catch(e) { return reply({error:e instanceof Error?e.message:'保存失败，请重试'},400); }
}
