/* eslint-disable */
// v0.6 压力测试：连续悬停多个不同视频、快速往返、取消率、内存/延迟记录。
const { app } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const TMP = path.join(os.tmpdir(), "vfb-v06-stress-" + Date.now());
const CACHE = path.join(TMP, "preview-cache");
const REPORT = path.join(__dirname, "smoke-out", "preview-stress.json");

app.whenReady().then(async () => {
  try {
    fs.mkdirSync(TMP, { recursive: true });
    const { execFileSync } = require("node:child_process");
    const seed = path.join(TMP, "seed.mp4");
    execFileSync("ffmpeg", [
      "-y", "-f", "lavfi", "-i", "testsrc2=duration=8:size=640x360:rate=12",
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", seed
    ], { stdio: "ignore" });

    // 准备 30 个不同路径的视频
    const videos = [];
    for (let i = 0; i < 30; i++) {
      const p = path.join(TMP, `video-${String(i).padStart(2, "0")}.mp4`);
      fs.copyFileSync(seed, p);
      videos.push(p);
    }

    const { PreviewService } = await import("../dist-electron/electron/preview.js");
    const service = new PreviewService({
      cacheDir: CACHE,
      isKnownVideoPath: () => true,
      getDuration: () => 8,
      probeDuration: async () => 8,
      isFfmpegAvailable: () => true
    });
    await service.initialize();
    const received = [];
    service.onResult = (result) => received.push(result);

    // 场景 1：连续悬停 30 个不同视频（模拟顺序 hover，每个停留到完成）
    const firstLatencies = [];
    for (let i = 0; i < videos.length; i++) {
      const requestId = `s1-${i}`;
      const t0 = Date.now();
      await service.request({ requestId, videoId: `v${i}`, filePath: videos[i] });
      while (!received.some((r) => r.requestId === requestId && r.state !== "loading")) {
        await new Promise((r) => setTimeout(r, 50));
        if (Date.now() - t0 > 60000) break;
      }
      const result = received.find((r) => r.requestId === requestId && r.state !== "loading");
      if (i < 3) console.log("DEBUG s1", i, "state:", result?.state, "received:", received.length);
      firstLatencies.push({
        index: i,
        elapsedMs: Date.now() - t0,
        state: result?.state,
        frameCount: result?.frames?.length ?? 0
      });
    }
    const coldResults = firstLatencies.filter((r) => r.state === "ready");
    const coldAvg = coldResults.reduce((s, r) => s + r.elapsedMs, 0) / Math.max(1, coldResults.length);

    // 场景 2：缓存命中延迟（再次顺序 hover 全部）
    const hitLatencies = [];
    for (let i = 0; i < videos.length; i++) {
      const requestId = `s2-${i}`;
      const t0 = Date.now();
      await service.request({ requestId, videoId: `v${i}`, filePath: videos[i] });
      const result = received.find((r) => r.requestId === requestId && r.state !== "loading");
      hitLatencies.push({ index: i, elapsedMs: Date.now() - t0, state: result?.state });
    }
    const hitResults = hitLatencies.filter((r) => r.state === "ready");
    const hitAvg = hitResults.reduce((s, r) => s + r.elapsedMs, 0) / Math.max(1, hitResults.length);

    // 场景 3：10 个视频快速往返（模拟快速移动鼠标，多数请求被取消）
    const fastStart = Date.now();
    let cancelledCount = 0;
    for (let round = 0; round < 5; round++) {
      for (let i = 0; i < 10; i++) {
        const requestId = `s3-${round}-${i}`;
        await service.request({ requestId, videoId: `fast-${i}`, filePath: videos[i] });
        if (i % 3 === 0) {
          service.cancel(requestId);
          cancelledCount += 1;
        }
      }
      await new Promise((r) => setTimeout(r, 800));
    }
    const fastElapsed = Date.now() - fastStart;
    const fastReady = received.filter((r) => r.requestId.startsWith("s3-") && r.state === "ready").length;

    const stats = await service.stats();
    const memory = process.memoryUsage();
    const queueDepth = 0; // 服务内部队列

    const report = {
      scenario: "preview stress",
      timestamp: new Date().toISOString(),
      videos: videos.length,
      cold: {
        success: coldResults.length,
        avgMs: Math.round(coldAvg),
        maxMs: Math.max(...firstLatencies.map((r) => r.elapsedMs)),
        failures: firstLatencies.filter((r) => r.state !== "ready").length
      },
      cacheHit: {
        success: hitResults.length,
        avgMs: Math.round(hitAvg),
        maxMs: Math.max(...hitLatencies.map((r) => r.elapsedMs))
      },
      fastSwitching: {
        totalRequests: 50,
        cancelled: cancelledCount,
        readyResults: fastReady,
        totalMs: fastElapsed
      },
      cacheStats: stats,
      memoryMB: {
        rss: Math.round(memory.rss / 1024 / 1024),
        heapUsed: Math.round(memory.heapUsed / 1024 / 1024)
      }
    };
    console.log(JSON.stringify(report, null, 2));
    fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
    app.quit();
    setTimeout(() => process.exit(0), 1000);
  } catch (error) {
    console.log("STRESS ERROR:", error instanceof Error ? error.stack : String(error));
    app.quit();
    setTimeout(() => process.exit(1), 500);
  }
});
