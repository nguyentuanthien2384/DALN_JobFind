import { describe, expect, it } from 'vitest';
import { assertUnchangedDeadline, editedDetail, DETAIL_FIELDS } from '../job-core-service/src/libs/jobEdit.js';

const detail = Object.fromEntries(DETAIL_FIELDS.map(field => [field, field === 'amount' ? 2 : field]));
describe('job edit value semantics', () => {
    it.each(DETAIL_FIELDS)('only changes explicitly supplied %s', field => {
        const value = field === 'amount' ? 3 : 'New value';
        const result = editedDetail(detail, { [field]: value });
        expect(result.detail).toEqual({ ...detail, [field]: value });
        expect(result.changed).toBe(true);
        expect(result.needsModeration).toBe(['name', 'descriptionHTML'].includes(field));
        expect(detail[field]).not.toBe(value);
    });
    it('normalizes numeric strings and treats an identical full form as a no-op', () => {
        expect(editedDetail(detail, { ...detail, amount: '2' })).toEqual({ detail, changed: false, needsModeration: false });
    });
    it('distinguishes omitted fields from explicit null and empty strings', () => {
        const result = editedDetail(detail, { addressCode: null, genderPostCode: null, descriptionMarkdown: '' });
        expect(result.detail).toEqual({ ...detail, addressCode: null, genderPostCode: null, descriptionMarkdown: '' });
        expect(result.changed).toBe(true);
        expect(result.needsModeration).toBe(false);
    });
    it('ignores transport metadata in the detail snapshot', () => {
        expect(editedDetail(detail, { timeEnd: 1, userId: 999, isHot: 1, statusCode: 'PS1' }).changed).toBe(false);
    });
    it.each([{}, { timeEnd: 1700000000000 }, { timeEnd: '1700000000000' }])('accepts an unchanged expired deadline: %j', patch => {
        expect(() => assertUnchangedDeadline({ timeEnd: '1700000000000' }, patch)).not.toThrow();
    });
    it.each([null, 1700000000001, '1699999999999'])('refuses replacing the original deadline with %s', timeEnd => {
        expect(() => assertUnchangedDeadline({ timeEnd: '1700000000000' }, { timeEnd })).toThrow('Đăng lại');
    });
});
