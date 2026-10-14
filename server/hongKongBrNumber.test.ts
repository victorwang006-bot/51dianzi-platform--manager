import {describe,it,expect} from 'vitest';
import {toMerchantHkRegistrationDetail} from './db';
import {hkRegistrationDataSchema,normalizeHkBrCertificateNumber} from '../shared/hongKongRegistration';
const valid={companyName:'SYNTHETIC HK LIMITED',chineseName:'',businessNature:'SYNTHETIC',legalStatus:'BODY CORPORATE',brn:'00123456',registrationNumber:'00123456-000-04-26-0',brStartDate:'2026-01-01',brExpiryDate:'2099-12-31',ciNumber:'SYNTHETIC-CI',establishedAt:'',regAddress:'SYNTHETIC',bankAccountName:'SYNTHETIC HK LIMITED',bankAccountNumber:'001-123-456',bankName:'SYNTHETIC BANK'};
const detail=(registration:typeof valid)=>toMerchantHkRegistrationDetail({registrationRegion:'HK',registrationIdentifier:'HK:00123456',businessLicense:null,registrationData:{registration,documents:{BR:{fileName:'BR.pdf'},CI:{fileName:'CI.pdf'},BANK:{fileName:'BANK.pdf'}}}} as never);
describe('后台完整BR号码与历史保护',()=>{
 it.each(['00123456-000-04-26-0','0012345600004260','００１２３４５６－０００－０４－２６－０'])('新申请正规证号保持身份 %s',number=>{const parsed=hkRegistrationDataSchema.parse({...valid,registrationNumber:number});expect(parsed.registrationNumber).toBe('00123456-000-04-26-0');expect(detail({...valid,registrationNumber:number})).toMatchObject({identity:'HK:00123456',brn:'00123456'});});
 it('旧四组已存资料可读不补造号码，但新提交仍拒绝缺失组',()=>{const legacy={...valid,registrationNumber:'00123456-000-26-0'};expect(detail(legacy)).toMatchObject({identity:'HK:00123456',brn:'00123456',registrationNumber:'00123456-000-26-0'});expect(normalizeHkBrCertificateNumber(legacy.registrationNumber)).toBeNull();expect(hkRegistrationDataSchema.safeParse(legacy).success).toBe(false);});
 it('错误BRN即使号码正确也拒绝',()=>{expect(hkRegistrationDataSchema.safeParse({...valid,brn:'87654321'}).success).toBe(false);});
 it('有效期已过不隐藏原有效历史资料，但不能作为新申请',()=>{const expired={...valid,brExpiryDate:'2026-02-01'};expect(detail(expired)).toMatchObject({identity:'HK:00123456'});expect(hkRegistrationDataSchema.safeParse(expired).success).toBe(false);});
});
