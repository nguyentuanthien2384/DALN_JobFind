const { createSkillMatcher, prepareSkillText } = require('../../src/utils/skillMatch');

const matches = (skill, text) => createSkillMatcher(skill).matches(prepareSkillText(text));

describe('skill matching', () => {
  test.each([
    ['C++', 'Lập trình C++ hiệu năng cao'],
    ['C++', 'Kinh nghiệm C++17 và STL'],
    ['C#', 'Phát triển ứng dụng C# / .NET'],
    ['C#', 'c#10, LINQ'],
    ['C', 'Ngôn ngữ C cho hệ nhúng'],
    ['C', 'C, C++ và Python'],
    ['Go', 'Backend bằng Go và gRPC'],
    ['R', 'Phân tích dữ liệu với R, SQL'],
    ['.NET', 'ASP.NET Core Web API'],
    ['.NET', 'Kinh nghiệm .NET 8'],
    ['C/C++', 'Thành thạo C/C++'],
    ['3D', 'Thiết kế 3D bằng Blender'],
    ['UI', 'Thiết kế UI/UX'],
  ])('%s matches as a whole term in %p', (skill, text) => {
    expect(matches(skill, text)).toBe(true);
  });

  test.each([
    ['C++', 'React developer với Node.js'],
    ['C++', 'Có kinh nghiệm C và C#'],
    ['C#', 'Lập trình C++'],
    ['C', 'React, Vue và Docker'],
    ['C', 'Thành thạo C++ và C#'],
    ['Go', 'Làm việc với Google Cloud'],
    ['Go', 'MongoDB và Django'],
    ['R', 'Rust, Ruby on Rails'],
    ['.NET', 'Quản trị mạng internet và network'],
    ['UI', 'Build tooling and guidelines'],
    ['3D', 'Kinh nghiệm 13 năm thiết kế'],
  ])('%s does not match unrelated text %p', (skill, text) => {
    expect(matches(skill, text)).toBe(false);
  });

  test.each([
    ['React', 'ReactJS, Redux'],
    ['Node.js', 'NodeJS, Express'],
    ['Node.js', 'Node.js / NestJS'],
    ['JavaScript', 'Java Script ES6'],
    ['Kỹ năng giao tiếp', 'Có KỸ NĂNG GIAO TIẾP tốt'],
    ['Đàm phán', 'dam phan voi khach hang'],
    ['SQL', 'MySQL và PostgreSQL'],
  ])('longer skill %s keeps accent- and spacing-insensitive matching in %p', (skill, text) => {
    expect(matches(skill, text)).toBe(true);
  });

  test('matching ignores case, accents and HTML markup around the term', () => {
    expect(matches('C#', '<li><strong>C#</strong></li>')).toBe(true);
    expect(matches('Go', '<p>GO&nbsp;microservices</p>')).toBe(true);
    expect(matches('Đồ họa', '<p>Thiết kế ĐỒ HỌA</p>')).toBe(true);
  });

  test.each([null, undefined, '', '   ', '!!!', '/'])('a skill name without any term (%p) has no matcher', (name) => {
    expect(createSkillMatcher(name)).toBeNull();
  });

  test('digit-only names match only the same number, not every text', () => {
    expect(matches('123', 'Mã 123')).toBe(true);
    expect(matches('123', 'Mã 1234')).toBe(false);
    expect(matches('123', 'Không có số')).toBe(false);
  });

  test('prepared text tolerates empty input', () => {
    expect(prepareSkillText(null)).toEqual({ flat: '', token: '  ' });
    expect(matches('React', null)).toBe(false);
    expect(matches('C++', undefined)).toBe(false);
  });

  test('regular-expression characters in a skill name are treated literally', () => {
    expect(matches('C++', 'Cxx developer')).toBe(false);
    expect(matches('a+b', 'a+b testing')).toBe(true);
    expect(matches('a+b', 'aab testing')).toBe(false);
  });
});
