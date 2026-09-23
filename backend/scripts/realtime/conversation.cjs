// Acceptance for the actual candidate/recruiter rule, not the ADMIN exception.
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs/promises");
const { chromium, firefox, webkit, expect } = require("@playwright/test");
module.exports = async ({ nodes, db, tokenFor, seedSessions }) => {
  const output = path.resolve(
    __dirname,
    "../../../.local/websocket-checks/conversation-2026-09-19",
  );
  await fs.mkdir(output, { recursive: true });
  const results = [];
  let id = 300;
  for (const [engine, launcher] of Object.entries({
    chromium,
    firefox,
    webkit,
  })) {
    const candidate = id++,
      recruiter = id++,
      outsider = id++,
      company = id++;
    await db.Company.create({
      id: company,
      name: "Công ty thử nghiệm An Bình",
      statusCode: "S1",
      censorCode: "CS1",
    });
    await db.User.bulkCreate([
      { id: candidate, firstName: "Minh", lastName: "Ứng viên" },
      {
        id: recruiter,
        companyId: company,
        firstName: "Lan",
        lastName: "Tuyển dụng",
      },
      { id: outsider, firstName: "Người ngoài" },
    ]);
    await db.Account.bulkCreate([
      { userId: candidate, roleCode: "CANDIDATE", statusCode: "S1" },
      { userId: recruiter, roleCode: "EMPLOYER", statusCode: "S1" },
      { userId: outsider, roleCode: "CANDIDATE", statusCode: "S1" },
    ]);
    await seedSessions([candidate, recruiter, outsider]);
    const browser = await launcher.launch({ headless: true });
    const errors = [];
    const transcript = [];
    try {
      const open = async (userId, roleCode, partnerId, url) => {
        const context = await browser.newContext({
          viewport: { width: 1280, height: 900 },
        });
        await context.addInitScript(
          ({ userId, roleCode, token }) => {
            localStorage.setItem(
              "userData",
              JSON.stringify({ id: userId, roleCode }),
            );
            localStorage.setItem("token_user", token);
          },
          { userId, roleCode, token: tokenFor(userId) },
        );
        const page = await context.newPage();
        page.on("pageerror", (e) => errors.push(e.message));
        await page.goto(`${url}/chat/${partnerId}`);
        await expect(page.getByPlaceholder("Nhập tin nhắn...")).toBeVisible();
        return { page, context };
      };
      const a = await open(candidate, "CANDIDATE", recruiter, nodes[0]);
      const b = await open(recruiter, "EMPLOYER", candidate, nodes[1]);
      await expect(
        a.page.getByText("Đang trực tuyến", { exact: true }),
      ).toBeVisible({ timeout: 45000 });
      await expect(
        b.page.getByText("Đang trực tuyến", { exact: true }),
      ).toBeVisible({ timeout: 45000 });
      const contentNodes = (page) =>
        page.locator('[role="log"] .chat-bubble .chat-message-text');
      const waiting = (page) =>
        page.getByRole("status", { name: "Đang chờ nhà tuyển dụng trả lời" });
      await expect(waiting(a.page)).toHaveCount(0);
      await expect(waiting(b.page)).toHaveCount(0);
      const send = async (from, to, content) => {
        const input = from.page.getByPlaceholder("Nhập tin nhắn...");
        await input.fill(content);
        await expect(to.page.getByText("đang soạn tin nhắn...")).toBeVisible({
          timeout: 8000,
        });
        await from.page
          .getByRole("button", { name: "Gửi tin nhắn", exact: true })
          .click();
        await expect(input).toHaveValue("");
        transcript.push(content);
        await expect(contentNodes(to.page)).toHaveText(transcript, {
          timeout: 10000,
        });
        await expect(contentNodes(from.page)).toHaveText(transcript);
        await expect(
          from.page.getByText("Đã xem", { exact: true }),
        ).toBeVisible({ timeout: 10000 });
        // Reading is not a reply; only a recruiter's message clears the receipt.
        await expect(waiting(a.page)).toHaveCount(from === a ? 1 : 0);
        await expect(waiting(b.page)).toHaveCount(0);
      };
      await send(
        a,
        b,
        "Chào chị Lan, em là Minh. Em muốn ứng tuyển vị trí lập trình viên React tại An Bình.",
      );
      await a.page.screenshot({
        path: path.join(output, `waiting-${engine}-desktop.png`),
      });
      await a.page.setViewportSize({ width: 390, height: 844 });
      await waiting(a.page).scrollIntoViewIfNeeded();
      await expect(waiting(a.page)).toBeVisible();
      await expect(a.page.getByPlaceholder("Nhập tin nhắn...")).toBeVisible();
      assert.equal(await a.page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ), true);
      await a.page.screenshot({
        path: path.join(output, `waiting-${engine}-mobile.png`),
      });
      await a.page.setViewportSize({ width: 1280, height: 900 });
      await a.page.reload();
      await expect(contentNodes(a.page)).toHaveText(transcript);
      await expect(waiting(a.page)).toHaveCount(1);
      await send(a, b, "Chị cho em hỏi thêm về hình thức làm việc và thời gian thử việc nhé.");
      const secondCandidateTab = await open(candidate, "CANDIDATE", recruiter, nodes[1]);
      await expect(contentNodes(secondCandidateTab.page)).toHaveText(transcript);
      await expect(waiting(secondCandidateTab.page)).toHaveCount(1);
      await send(
        b,
        a,
        "Chào Minh! Chị đã nhận hồ sơ. Em có thể phỏng vấn lúc 09:30 ngày 22/09 không?",
      );
      await expect(waiting(secondCandidateTab.page)).toHaveCount(0);
      await secondCandidateTab.context.close();
      await send(
        a,
        b,
        "Dạ được chị. Em có 2 năm kinh nghiệm React & Node.js; em sẽ chuẩn bị bản demo. Cảm ơn chị 😊",
      );
      await send(
        b,
        a,
        "Chị xác nhận lịch 09:30. Mã lịch hẹn: AB-2026-0922. Hẹn gặp em!",
      );
      for (const [name, side] of [
        ["candidate", a],
        ["recruiter", b],
      ])
        await side.page.screenshot({
          path: path.join(output, `${engine}-${name}.png`),
          fullPage: true,
        });
      await a.page.reload();
      await b.page.reload();
      await expect(contentNodes(a.page)).toHaveText(transcript);
      await expect(contentNodes(b.page)).toHaveText(transcript);
      // Preserve Unicode and the 2,000-character boundary, render markup as text.
      const long =
        "Nội dung kiểm thử tiếng Việt: " +
        "á".repeat(2000 - "Nội dung kiểm thử tiếng Việt: ".length);
      await send(a, b, long);
      await send(
        b,
        a,
        'Chuỗi kiểm thử an toàn: <img src=x onerror=alert(1)> & "lịch hẹn"; SELECT * FROM users;',
      );
      assert.equal(await a.page.locator('[role="log"] img').count(), 0);
      const headers = (id) => ({
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenFor(id)}`,
      });
      const read = async (user, partner) => {
        const response = await fetch(
          `${nodes[0]}/api/get-chat-conversation?partnerId=${partner}`,
          { headers: headers(user) },
        );
        return response.json();
      };
      for (const [user, partner] of [
        [candidate, recruiter],
        [recruiter, candidate],
      ]) {
        const history = await read(user, partner);
        assert.equal(history.errCode, 0);
        assert.deepEqual(
          history.data.map((m) => m.content),
          transcript,
        );
        assert.equal(history.partnerData.id, partner);
        assert.deepEqual(history.conversationMeta.waitingReply, {
          candidateId: candidate,
          recruiterId: recruiter,
        });
      }
      const rows = await db.ChatMessage.findAll({
        where: {
          senderId: [candidate, recruiter],
          receiverId: [candidate, recruiter],
        },
        order: [["id", "ASC"]],
        raw: true,
      });
      assert.deepEqual(
        rows.map((m) => m.content),
        transcript,
      );
      assert.equal(
        new Set(rows.map((m) => m.clientMessageId)).size,
        transcript.length,
      );
      assert.ok(rows.every((m) => +m.isRead === 1));
      const duplicate = await fetch(`${nodes[1]}/api/send-chat-message`, {
        method: "POST",
        headers: headers(candidate),
        body: JSON.stringify({
          receiverId: recruiter,
          content: rows[0].content,
          clientMessageId: rows[0].clientMessageId,
        }),
      });
      assert.equal((await duplicate.json()).data.id, rows[0].id);
      const blocked = await read(outsider, candidate);
      assert.equal(blocked.errCode, 5);
      for (const payload of [
        {
          receiverId: recruiter,
          content: "x".repeat(2001),
          clientMessageId: `too-long-${engine}-20260919`,
        },
        {
          receiverId: recruiter,
          senderId: outsider,
          content: "spoof",
          clientMessageId: `spoof-${engine}-20260919`,
        },
      ]) {
        const response = await fetch(`${nodes[0]}/api/send-chat-message`, {
          method: "POST",
          headers: headers(candidate),
          body: JSON.stringify(payload),
        });
        assert.equal(response.status, 400);
      }
      await db.Company.update(
        { censorCode: "CS2" },
        { where: { id: company } },
      );
      const disallowed = await fetch(`${nodes[0]}/api/send-chat-message`, {
        method: "POST",
        headers: headers(candidate),
        body: JSON.stringify({
          receiverId: recruiter,
          content: "blocked company",
          clientMessageId: `blocked-company-${engine}-20260919`,
        }),
      });
      assert.equal(disallowed.status, 403);
      await db.Company.update(
        { censorCode: "CS1" },
        { where: { id: company } },
      );
      const lostAck =
        "Kiểm thử mất ACK: tin này chỉ được lưu một lần dù trình duyệt gửi dự phòng.";
      const fallback = a.page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/send-chat-message") &&
          response.request().method() === "POST",
        { timeout: 15000 },
      );
      await a.page.getByPlaceholder("Nhập tin nhắn...").fill(lostAck);
      await a.page
        .getByRole("button", { name: "Gửi tin nhắn", exact: true })
        .click();
      const ackResponse = await fallback;
      assert.equal((await ackResponse.json()).errCode, 0);
      await expect(a.page.getByPlaceholder("Nhập tin nhắn...")).toHaveValue("");
      transcript.push(lostAck);
      await expect(contentNodes(a.page)).toHaveText(transcript);
      await expect(contentNodes(b.page)).toHaveText(transcript);
      await expect(waiting(a.page)).toHaveCount(1);
      await expect(waiting(b.page)).toHaveCount(0);
      assert.equal(
        await db.ChatMessage.count({
          where: { senderId: candidate, content: lostAck },
        }),
        1,
      );
      // Test lost connectivity with the recruiter sending a real new message.
      await a.context.setOffline(true);
      const offlineMessage =
        "Tin gửi lúc ứng viên mất mạng: nhớ mang theo bản demo nhé!";
      await b.page.getByPlaceholder("Nhập tin nhắn...").fill(offlineMessage);
      await b.page
        .getByRole("button", { name: "Gửi tin nhắn", exact: true })
        .click();
      await expect(b.page.getByPlaceholder("Nhập tin nhắn...")).toHaveValue("");
      transcript.push(offlineMessage);
      await a.context.setOffline(false);
      await expect(contentNodes(a.page)).toHaveText(transcript, {
        timeout: 25000,
      });
      await a.page.reload();
      await expect(contentNodes(a.page)).toHaveText(transcript);
      await expect(waiting(a.page)).toHaveCount(0);
      // REST may return multiline text even though the current composer is single-line.
      const multiline =
        "Thông tin phỏng vấn:\nĐịa điểm: Văn phòng An Bình\nChuẩn bị: CV  và  bản demo";
      const multi = await fetch(`${nodes[0]}/api/send-chat-message`, {
        method: "POST",
        headers: headers(recruiter),
        body: JSON.stringify({
          receiverId: candidate,
          content: multiline,
          clientMessageId: `multiline-${engine}-acceptance-20260919`,
        }),
      });
      assert.equal((await multi.json()).errCode, 0);
      transcript.push(multiline);
      await expect(contentNodes(a.page)).toHaveText(transcript);
      const preserved = await contentNodes(a.page)
        .last()
        .evaluate((el) => ({
          text: el.textContent,
          whiteSpace: getComputedStyle(el).whiteSpace,
        }));
      assert.equal(preserved.text, multiline);
      assert.ok(
        ["pre-wrap", "pre-line", "break-spaces"].includes(preserved.whiteSpace),
        `Multiline content is visually collapsed: ${preserved.whiteSpace}`,
      );
      await a.page.setViewportSize({ width: 390, height: 844 });
      await contentNodes(a.page).last().scrollIntoViewIfNeeded();
      await expect(contentNodes(a.page).last()).toBeVisible();
      await expect(a.page.getByPlaceholder("Nhập tin nhắn...")).toBeVisible();
      assert.equal(
        await a.page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      await a.page.screenshot({
        path: path.join(output, `${engine}-mobile.png`),
      });
      assert.deepEqual(errors, []);
      const saved = await db.ChatMessage.findAll({
        where: {
          senderId: [candidate, recruiter],
          receiverId: [candidate, recruiter],
        },
        order: [["id", "ASC"]],
        raw: true,
      });
      assert.deepEqual(
        saved.map((m) => m.content),
        transcript,
      );
      results.push({
        engine,
        candidateRole: "CANDIDATE",
        recruiterRole: "EMPLOYER",
        approvedCompany: true,
        messages: transcript.length,
        contentExact: true,
        reload: true,
        offlineRecovery: true,
        deduplicated: true,
        lostAckRestFallback: true,
        readReceipt: true,
        typing: true,
        online: true,
        outsiderDenied: true,
        unapprovedCompanyDenied: true,
        spoofRejected: true,
        oversizeRejected: true,
        multiline: true,
        mobileNoOverflow: true,
        waitingReply: {
          confirmedMessagesOnly: true,
          singleBubbleForMultipleQuestions: true,
          remainsAfterRead: true,
          restoredAfterReloadAndOtherTab: true,
          clearedOnReplyAndOfflineRecovery: true,
          candidateOnly: true,
          noSyntheticDatabaseMessages: true,
          mobileNoOverflow: true,
        },
        transcript: saved.map(({ senderId, content, id, isRead }) => ({
          id,
          from: senderId === candidate ? "Ứng viên" : "Nhà tuyển dụng",
          content,
          isRead,
        })),
      });
      console.log(
        `PASS ${engine}: candidate <-> approved-company recruiter, ${transcript.length} exact messages, both UIs/API/SQL, reload, typing/read/presence, offline recovery, lost ACK -> REST with one row, duplicate retry, 2000 chars, safe text, multiline, mobile, unauthorized/spoof/oversize denied`,
      );
    } finally {
      await browser.close();
    }
  }
  await fs.writeFile(
    path.join(output, "result.json"),
    JSON.stringify({ testedAt: new Date().toISOString(), results }, null, 2),
  );
};
