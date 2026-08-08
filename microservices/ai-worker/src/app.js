import { createLogger } from "../../shared/logger.js";
import { consume, publish } from "../../shared/rabbitmq.js";
import { EVENTS, QUEUES } from "../../shared/events.js";
import { isConfigured, logModel } from "./libs/claude.js";
import { parseResume } from "./jobs/resumeParser.js";
import { matchCv } from "./jobs/smartMatching.js";
import { moderateJob } from "./jobs/moderation.js";
import { generateCoverLetter } from "./jobs/coverLetter.js";

const logger = createLogger("ai-worker");

// AI Worker chay hoan toan doc lap: khong mo cong HTTP, khong ai goi truc tiep
// duoc vao. Viec den qua RabbitMQ va ket qua cung di ra bang RabbitMQ. Nho vay
// mot dot CV o at khong lam sap API - chung chi nam cho trong hang doi - va co
// the nhan ban them worker khi can ma khong dong toi service nao khac.

const handlers = {
  [EVENTS.AI_MODERATE_JOB]: {
    type: "moderate_job",
    run: (payload) => moderateJob(payload),
  },
  [EVENTS.AI_PARSE_RESUME]: {
    type: "parse_resume",
    run: (payload) => parseResume(payload),
  },
  [EVENTS.AI_MATCH_CV]: {
    type: "match_cv",
    run: (payload) => matchCv(payload),
  },
  [EVENTS.AI_COVER_LETTER]: {
    type: "cover_letter",
    run: (payload) => generateCoverLetter(payload),
  },
};

const start = async () => {
  if (!isConfigured()) {
    logger.warn(
      "Chua co ANTHROPIC_API_KEY. Worker van chay va van nhan viec, nhung moi " +
        "tac vu se tra ve loi cau hinh. Dat bien moi truong roi khoi dong lai.",
    );
  }
  logModel();

  await consume(
    QUEUES.AI_WORKER,
    Object.keys(handlers),
    async (payload, routingKey) => {
      const handler = handlers[routingKey];
      if (!handler) {
        logger.warn("khong co ham xu ly cho su kien nay", { routingKey });
        return;
      }

      const started = Date.now();
      logger.info("nhan viec", {
        type: handler.type,
        taskId: payload.taskId,
        jobId: payload.jobId,
      });

      if (!isConfigured()) {
        await publish(EVENTS.AI_RESULT, {
          taskId: payload.taskId,
          jobId: payload.jobId,
          type: handler.type,
          ok: false,
          error: "Máy chủ chưa cấu hình ANTHROPIC_API_KEY",
        });
        return;
      }

      try {
        const result = await handler.run(payload);
        await publish(EVENTS.AI_RESULT, {
          taskId: payload.taskId,
          jobId: payload.jobId,
          type: handler.type,
          ok: true,
          result,
        });
        logger.info("xong", {
          type: handler.type,
          taskId: payload.taskId,
          jobId: payload.jobId,
          durationMs: Date.now() - started,
        });
      } catch (error) {
        // Bao that bai ve cho ben yeu cau thay vi de tin nam im. Neu nem
        // loi ra ngoai, tin se bi nack va nguoi dung cho mai khong thay ket qua.
        logger.error("xu ly that bai", {
          type: handler.type,
          taskId: payload.taskId,
          error: error.message,
        });
        await publish(EVENTS.AI_RESULT, {
          taskId: payload.taskId,
          jobId: payload.jobId,
          type: handler.type,
          ok: false,
          error: error.message,
        });
      }
    },
    // Moi tin ton mot lan goi model - gioi han so viec chay song song de khong
    // dam vao han muc goi API.
    { prefetch: Number(process.env.AI_CONCURRENCY || 2) },
  );

  logger.info("AI Worker dang cho viec tu RabbitMQ");
};

start().catch((error) => {
  logger.error("khong khoi dong duoc", { error: error.message });
  process.exit(1);
});
