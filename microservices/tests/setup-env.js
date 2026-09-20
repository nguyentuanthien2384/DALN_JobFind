process.env.JWT_SECRET ||= 'microservice-unit-test-secret-2026-unique';
process.env.AUTH_ALLOW_LEGACY_TOKENS = 'true';
process.env.RABBITMQ_URL ||= 'amqp://unit-test:unit-test-password@localhost:5672';
process.env.POSTGRES_URL ||= 'postgres://unit-test:unit-test-password@localhost:5432/test_db';
