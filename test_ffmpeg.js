const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const ffmpegPath = require("ffmpeg-static");

const runFfmpeg = (args) => {
  return new Promise((resolve, reject) => {
    execFile(ffmpegPath, args, (error, stdout, stderr) => {
      if (error) {
        error.stderr = stderr;
        reject(error);
        return;
      }

      resolve({ stdout, stderr });
    });
  });
};

const escapeFfmpegFilterValue = (value) => {
  return String(value)
    .replace(/\\/g, "/")
    .replace(/:/g, "\\\\:")
    .replace(/'/g, "\\'")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/ /g, "\\ ");
};

const buildAssOverlayContent = (text) => {
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    "PlayResX: 640",
    "PlayResY: 480",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    "Style: Overlay,DejaVu Sans,36,&H00FFFFFF,&H00FFFFFF,&HCC000000,&H99000000,-1,0,0,0,100,100,0,0,1,4,0,1,24,24,24,1",
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    `Dialogue: 0,0:00:00.00,9:59:59.00,Overlay,,0,0,0,,${text}`,
    "",
  ].join("\n");
};

async function testFfmpeg() {
  const overlayText = "SPXVN067513314575 - 14:09:03 20/5/2026";
  const assPath = path.join(__dirname, "test.ass");
  const mainVideo = path.join(__dirname, "dummy-main.mp4");
  const secondVideo = path.join(__dirname, "dummy-second.mp4");
  const outVideo = path.join(__dirname, "out.webm");

  fs.writeFileSync(assPath, buildAssOverlayContent(overlayText), "utf8");

  if (!fs.existsSync(mainVideo)) {
    await runFfmpeg([
      "-f",
      "lavfi",
      "-i",
      "testsrc=duration=2:size=640x480:rate=30",
      "-c:v",
      "libx264",
      mainVideo,
    ]);
  }

  if (!fs.existsSync(secondVideo)) {
    await runFfmpeg([
      "-f",
      "lavfi",
      "-i",
      "smptebars=duration=2:size=360x640:rate=30",
      "-c:v",
      "libx264",
      secondVideo,
    ]);
  }

  const escapedPath = escapeFfmpegFilterValue(assPath);
  const filterComplex =
    "[1:v]crop=w='if(gt(iw/ih,2/3),ih*2/3,iw)':h='if(gt(iw/ih,2/3),ih,iw*3/2)':x='(iw-ow)/2':y='(ih-oh)/2'[portrait]; " +
    "[portrait][0:v]scale2ref=w='min(main_h*0.94*2/3,main_w*0.50)':h='min(main_h*0.94,main_w*0.50*3/2)':flags=lanczos[pip][mainv]; " +
    `[mainv][pip]overlay=W-w-16:16:shortest=1:eof_action=pass[composited]; [composited]ass=${escapedPath}[outv]`;

  const args = [
    "-y",
    "-i",
    mainVideo,
    "-i",
    secondVideo,
    "-filter_complex",
    filterComplex,
    "-map",
    "[outv]",
    "-c:v",
    "libvpx-vp9",
    "-crf",
    "30",
    "-b:v",
    "0",
    "-deadline",
    "realtime",
    "-cpu-used",
    "6",
    "-row-mt",
    "1",
    outVideo,
  ];

  console.log("overlayText:", overlayText);
  console.log("escaped ASS path:", escapedPath);
  console.log("filterComplex:", filterComplex);

  try {
    const { stderr } = await runFfmpeg(args);
    console.log("Success! check out.webm");
    console.log(
      stderr
        .split(/\r?\n/)
        .filter((line) => /Parsed_ass|Added subtitle file|fontselect/i.test(line))
        .join("\n"),
    );
  } catch (error) {
    console.error("Error:", error.message);
    console.error("Stderr:", error.stderr);
    process.exitCode = 1;
  }
}

testFfmpeg();
