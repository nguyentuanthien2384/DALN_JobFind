const Sequelize = require('sequelize');
const seeder = require('../../src/seeders/20250101000020-demo-notifications');

test('sample notifications open their relevant lists and do not claim a fabricated new-job count', async () => {
    const queryInterface = { bulkInsert: jest.fn().mockResolvedValue(undefined) };
    await seeder.up(queryInterface, Sequelize);
    expect(queryInterface.bulkInsert).toHaveBeenCalledWith('Notifications', [
        expect.objectContaining({
            userId: 5, typeCode: 'NEW_POST', isChecked: 0,
            content: 'Việc làm từ các công ty bạn đang theo dõi',
            link: '/candidate/followed-jobs'
        }),
        expect.objectContaining({
            userId: 5, typeCode: 'NEW_POST', isChecked: 1,
            content: 'Việc làm phù hợp với hồ sơ của bạn',
            link: '/candidate/recommended-jobs'
        })
    ], {});
});

test('rolling back demo data only selects its two old or new notice signatures for the demo user', async () => {
    const queryInterface = { bulkDelete: jest.fn().mockResolvedValue(undefined) };
    await seeder.down(queryInterface, Sequelize);
    expect(queryInterface.bulkDelete).toHaveBeenCalledWith('Notifications', {
        userId: 5,
        typeCode: 'NEW_POST',
        [Sequelize.Op.or]: [
            { content: 'Công ty bạn theo dõi vừa đăng tin tuyển dụng mới', link: '/job' },
            { content: 'Việc làm từ các công ty bạn đang theo dõi', link: '/candidate/followed-jobs' },
            { content: 'Có 2 việc làm mới phù hợp với kỹ năng của bạn', link: '/job' },
            { content: 'Việc làm phù hợp với hồ sơ của bạn', link: '/candidate/recommended-jobs' }
        ]
    }, {});
});
