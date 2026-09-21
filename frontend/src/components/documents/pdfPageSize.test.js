import { boundedPdfPageSize, MAX_CANVAS_PIXELS, MAX_CANVAS_SIDE } from './pdfPageSize';

test.each([[595,842,780,1], [595,842,1560,3], [100,10000,1560,2], [10000,100,1560,2], [14400,14400,1560,2]])(
    'bounds canvas allocations before rendering %d × %d points at width %d / DPR %d', (width,height,requestedWidth,ratio) => {
        const size=boundedPdfPageSize({width,height},requestedWidth,ratio);
        const pixelsWide=Math.floor(size.width*size.devicePixelRatio),pixelsHigh=Math.floor(size.width/width*height*size.devicePixelRatio);
        expect(pixelsWide).toBeLessThanOrEqual(MAX_CANVAS_SIDE);
        expect(pixelsHigh).toBeLessThanOrEqual(MAX_CANVAS_SIDE);
        expect(pixelsWide*pixelsHigh).toBeLessThanOrEqual(MAX_CANVAS_PIXELS);
        expect(size.width).toBeLessThanOrEqual(requestedWidth);
    });
test('preserves the requested width for ordinary documents and reports constrained unusual pages',()=>{
    expect(boundedPdfPageSize({width:595,height:842},780,1)).toEqual({width:780,devicePixelRatio:1,constrained:false});
    expect(boundedPdfPageSize({width:100,height:10000},1560,2).constrained).toBe(true);
});
test.each([{width:0,height:1},{width:Infinity,height:100},{width:100,height:NaN},{width:1,height:1e20}])('rejects impossible dimensions %j',dimensions=>{
    expect(()=>boundedPdfPageSize(dimensions,780,2)).toThrow(/PDF/);
});
