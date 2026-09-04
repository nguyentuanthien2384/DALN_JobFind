import { createLogger } from "../../shared/logger.js";
import { isConfigured, logModel } from "./libs/claude.js";
import { startTaskConsumer } from './consumers/taskConsumer.js';
import { ensureTaskStore } from './libs/taskStore.js';

const logger = createLogger("ai-worker");

// AI Worker chay hoan toan doc lap: khong mo cong HTTP, khong ai goi truc tiep
// duoc vao. Viec den qua RabbitMQ va ket qua cung di ra bang RabbitMQ. Nho vay
// mot dot CV o at khong lam sap API - chung chi nam cho trong hang doi - va co
// the nhan ban them worker khi can ma khong dong toi service nao khac.

const start = async () => {
  if (!isConfigured()) {
    logger.warn(
      "Chua co ANTHROPIC_API_KEY. Worker van chay va van nhan viec, nhung moi " +
        "tac vu se tra ve loi cau hinh. Dat bien moi truong roi khoi dong lai.",
    );
  }
  logModel();

  // Refuse to consume until durable deduplication is available.
  await ensureTaskStore();

  // Moi tin ton mot lan goi model - consumer gioi han so viec chay song song
  // de khong dam vao han muc goi API.
  await startTaskConsumer();

  logger.info("AI Worker dang cho viec tu RabbitMQ");
};

start().catch((error) => {
  logger.error("khong khoi dong duoc", { error: error.message });
  process.exit(1);
});
