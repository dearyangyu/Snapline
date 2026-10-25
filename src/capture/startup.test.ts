import { describe, expect, it, vi } from 'vitest';
import { presentPreparedCapture } from './startup';
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};}
describe('hidden capture readiness',()=>{
  it('never presents cancelled late image decode',async()=>{
    const decode=deferred();let cancelled=false;const present=vi.fn(async()=>true),failed=vi.fn(async()=>{});
    const work=presentPreparedCapture({cancelled:()=>cancelled,prepare:()=>decode.promise,present,pause:async()=>{},failed});
    cancelled=true;decode.resolve();await work;
    expect(present).not.toHaveBeenCalled();expect(failed).not.toHaveBeenCalled();
  });
  it('waits for prepared pixels and retries incomplete native layout',async()=>{
    const decode=deferred();const present=vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);const pause=vi.fn(async()=>{});
    const work=presentPreparedCapture({cancelled:()=>false,prepare:()=>decode.promise,present,pause,failed:vi.fn(async()=>{})});
    expect(present).not.toHaveBeenCalled();decode.resolve();await work;
    expect(present).toHaveBeenCalledTimes(2);expect(pause).toHaveBeenCalledOnce();
  });
  it('requests recovery for decode failure and bounded presentation timeout',async()=>{
    for(const reject of [true,false]){
      const failed=vi.fn(async()=>{}),present=vi.fn(async()=>false);
      await presentPreparedCapture({cancelled:()=>false,prepare:async()=>{if(reject)throw Error('decode');},present,pause:async()=>{},failed});
      expect(failed).toHaveBeenCalledOnce();expect(present).toHaveBeenCalledTimes(reject?0:40);
    }
  });
});
