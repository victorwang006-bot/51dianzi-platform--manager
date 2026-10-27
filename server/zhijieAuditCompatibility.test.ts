import {beforeEach,describe,it,expect,vi} from "vitest";
const pool=vi.hoisted(()=>({query:vi.fn(),execute:vi.fn()}));
vi.mock("mysql2/promise",()=>({default:{createPool:()=>pool}}));
import {MysqlZhijieAccessStore} from "./zhijie/store";
describe("审计LIMIT的MySQL兼容",()=>{
 beforeEach(()=>{pool.query.mockReset();pool.execute.mockReset();pool.query.mockResolvedValue([[]]);});
 it("使用安全文本参数，不把LIMIT绑定为DOUBLE",async()=>{const s=new MysqlZhijieAccessStore("mysql://isolated_test@127.0.0.1/not_connected");expect(await s.listAudits(50)).toEqual([]);expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("LIMIT ?"),[50]);expect(pool.execute).not.toHaveBeenCalled();});
 it("大分页被限制为100",async()=>{const s=new MysqlZhijieAccessStore("mysql://isolated_test@127.0.0.1/not_connected");await s.listAudits(10000);expect(pool.query).toHaveBeenCalledWith(expect.any(String),[100]);});
 it("分页下限为1",async()=>{const s=new MysqlZhijieAccessStore("mysql://isolated_test@127.0.0.1/not_connected");await s.listAudits(-5);expect(pool.query).toHaveBeenCalledWith(expect.any(String),[1]);});
});
