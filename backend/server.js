const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const util = require('util');
const { spawn, execFile } = require('child_process');
const sharp = require('sharp');

const execFileP = util.promisify(execFile);

const app = express();

const PORT = 5000;

const OLLAMA_URL =
    'http://127.0.0.1:11434/api/chat';

const OLLAMA_MODEL =
    'llama3.2:3b';

const TTS_VOICE =
    'en-IN-NeerjaNeural';

const TTS_LANGUAGE =
    'en-IN';

const VIDEO_WIDTH = 570;
const VIDEO_HEIGHT = 850;
const VIDEO_FPS = 30;

const ROOT_DIR = path.resolve(__dirname);

/*
 * In the packaged Windows application, Program Files is normally
 * not writable by a normal user.
 *
 * Electron passes TEACHBACK_DATA_DIR to the backend.
 * During normal development, we fall back to the backend folder.
 */
const DATA_DIR = process.env.TEACHBACK_DATA_DIR
    ? path.resolve(process.env.TEACHBACK_DATA_DIR)
    : ROOT_DIR;

const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const GENERATED_DIR = path.join(DATA_DIR, 'generated');
const TEMP_DIR = path.join(DATA_DIR, 'temp');

const TESSERACT_PATH =
    'C:\\Program Files\\Tesseract-OCR\\tesseract.exe';

const POPPLER_PATH =
    'C:\\Users\\samee\\AppData\\Local\\Microsoft\\WinGet\\Packages\\oschwartz10612.Poppler_Microsoft.Winget.Source_8wekyb3d8bbwe\\poppler-25.07.0\\Library\\bin\\pdftoppm.exe';

const FFMPEG_PATH =
    'C:\\Users\\samee\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-9.0.1-full_build\\bin\\ffmpeg.exe';

const FFPROBE_PATH =
    path.join(
        path.dirname(FFMPEG_PATH),
        'ffprobe.exe'
    );


/* =========================================================
   CREATE DIRECTORIES
========================================================= */

[
    UPLOAD_DIR,
    GENERATED_DIR,
    TEMP_DIR,
].forEach((dir) => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, {
            recursive: true,
        });
    }
});


/* =========================================================
   MIDDLEWARE
========================================================= */

app.use(
    cors({
        origin: true,
        credentials: false,
    })
);

app.use(
    express.json({
        limit: '50mb',
    })
);

app.use(
    express.urlencoded({
        extended: true,
        limit: '50mb',
    })
);

app.use(
    '/generated',
    express.static(GENERATED_DIR)
);


/* =========================================================
   ROOT ROUTE
========================================================= */

app.get('/', (req, res) => {
    res.json({
        success: true,
        app: 'TeachBack',
        status: 'running',
        server:
            `http://localhost:${PORT}`,
        generated:
            `http://localhost:${PORT}/generated`,
        ollama:
            OLLAMA_URL,
        model:
            OLLAMA_MODEL,
    });
});


/* =========================================================
   MULTER
========================================================= */

const storage =
    multer.diskStorage({
        destination:
            (req, file, cb) => {
                cb(
                    null,
                    UPLOAD_DIR
                );
            },

        filename:
            (req, file, cb) => {
                const safeName =
                    file.originalname
                        .replace(
                            /[^a-zA-Z0-9._-]/g,
                            '_'
                        );

                const unique =
                    `${Date.now()}-${crypto
                        .randomBytes(5)
                        .toString('hex')}`;

                cb(
                    null,
                    `${unique}-${safeName}`
                );
            },
    });


const upload =
    multer({
        storage,

        limits: {
            fileSize:
                20 * 1024 * 1024,
        },

        fileFilter:
            (req, file, cb) => {
                const isPdf =
                    file.mimetype ===
                    'application/pdf' ||
                    file.originalname
                        .toLowerCase()
                        .endsWith('.pdf');

                if (!isPdf) {
                    return cb(
                        new Error(
                            'Only PDF files are supported.'
                        )
                    );
                }

                cb(
                    null,
                    true
                );
            },
    });


/* =========================================================
   GENERAL HELPERS
========================================================= */

function cleanText(text) {
    if (!text) {
        return '';
    }

    return String(text)
        .replace(
            /\r/g,
            ' '
        )
        .replace(
            /\t/g,
            ' '
        )
        .replace(
            /[ ]{2,}/g,
            ' '
        )
        .replace(
            /\n{3,}/g,
            '\n\n'
        )
        .trim();
}


function safeFileName(name) {
    return String(
        name || 'file'
    ).replace(
        /[^a-zA-Z0-9._-]/g,
        '_'
    );
}


function sleep(ms) {
    return new Promise(
        (resolve) =>
            setTimeout(
                resolve,
                ms
            )
    );
}


function clamp(
    value,
    min,
    max
) {
    return Math.max(
        min,
        Math.min(
            max,
            value
        )
    );
}


function wordCount(text) {
    return cleanText(text)
        .split(/\s+/)
        .filter(Boolean)
        .length;
}


function makeId(
    prefix = 'item'
) {
    return (
        prefix +
        '-' +
        Date.now() +
        '-' +
        crypto
            .randomBytes(5)
            .toString('hex')
    );
}


/* =========================================================
   TOPIC KEYWORDS
========================================================= */

function topicKeywords(topic) {
    const stopWords =
        new Set([
            'the',
            'a',
            'an',
            'and',
            'or',
            'of',
            'to',
            'in',
            'on',
            'for',
            'with',
            'from',
            'by',
            'is',
            'are',
            'was',
            'were',
            'what',
            'how',
            'why',
            'explain',
            'explanation',
            'concept',
            'topic',
            'about',
            'this',
            'that',
            'using',
            'used',
            'use',
            'based',
            'study',
            'notes',
            'chapter',
            'unit',
        ]);

    return cleanText(topic)
        .toLowerCase()
        .replace(
            /[^a-z0-9\s-]/g,
            ' '
        )
        .split(/\s+/)
        .map(
            (word) =>
                word.trim()
        )
        .filter(
            (word) =>
                word.length >= 2 &&
                !stopWords.has(word)
        );
}


/* =========================================================
   BUILD TOPIC FOCUSED MATERIAL
========================================================= */

function buildTopicFocusedMaterial(
    text,
    topic
) {
    const source =
        cleanText(text);

    if (!source) {
        return '';
    }

    const cleanTopic =
        cleanText(topic);

    if (!cleanTopic) {
        return source.slice(
            0,
            30000
        );
    }

    const keywords =
        topicKeywords(
            cleanTopic
        );

    const paragraphs =
        source
            .split(
                /\n\s*\n/
            )
            .map(
                (p) =>
                    cleanText(p)
            )
            .filter(
                (p) =>
                    p.length > 20
            );

    if (
        !paragraphs.length
    ) {
        return source.slice(
            0,
            30000
        );
    }

    const scored =
        paragraphs.map(
            (
                paragraph,
                index
            ) => {
                const lower =
                    paragraph.toLowerCase();

                let score = 0;

                if (
                    lower.includes(
                        cleanTopic.toLowerCase()
                    )
                ) {
                    score += 100;
                }

                keywords.forEach(
                    (keyword) => {
                        const escaped =
                            keyword.replace(
                                /[.*+?^${}()|[\]\\]/g,
                                '\\$&'
                            );

                        const matches =
                            lower.match(
                                new RegExp(
                                    `\\b${escaped}\\b`,
                                    'g'
                                )
                            );

                        if (matches) {
                            score +=
                                Math.min(
                                    matches.length,
                                    8
                                ) * 8;
                        }
                    }
                );

                const looksLikeHeading =
                    paragraph.length <=
                    180 &&
                    (
                        paragraph ===
                        paragraph.toUpperCase() ||
                        /^[0-9]+[.)]\s/.test(
                            paragraph
                        ) ||
                        /^[A-Z][A-Za-z0-9\s:/&()_-]{2,100}$/.test(
                            paragraph
                        )
                    );

                if (
                    looksLikeHeading
                ) {
                    if (
                        lower.includes(
                            cleanTopic.toLowerCase()
                        )
                    ) {
                        score += 100;
                    }

                    keywords.forEach(
                        (keyword) => {
                            if (
                                lower.includes(
                                    keyword
                                )
                            ) {
                                score += 15;
                            }
                        }
                    );
                }

                return {
                    index,
                    paragraph,
                    score,
                };
            }
        );

    const meaningful =
        scored.filter(
            (item) =>
                item.score > 0
        );

    if (
        !meaningful.length
    ) {
        console.log(
            'No strong topic match found. Using limited PDF context.'
        );

        return source.slice(
            0,
            18000
        );
    }

    const ranked =
        [...meaningful].sort(
            (a, b) => {
                if (
                    b.score !==
                    a.score
                ) {
                    return (
                        b.score -
                        a.score
                    );
                }

                return (
                    a.index -
                    b.index
                );
            }
        );

    const selectedIndexes =
        new Set();

    ranked
        .slice(
            0,
            28
        )
        .forEach(
            (item) => {
                selectedIndexes.add(
                    item.index
                );

                if (
                    item.index > 0 &&
                    selectedIndexes.size <
                    40
                ) {
                    selectedIndexes.add(
                        item.index - 1
                    );
                }

                if (
                    item.index + 1 <
                    paragraphs.length &&
                    selectedIndexes.size <
                    40
                ) {
                    selectedIndexes.add(
                        item.index + 1
                    );
                }
            }
        );

    const orderedIndexes =
        [...selectedIndexes].sort(
            (a, b) =>
                a - b
        );

    let focused = '';

    orderedIndexes.forEach(
        (index) => {
            focused +=
                '\n\n' +
                paragraphs[index];
        }
    );

    focused =
        cleanText(focused);

    if (
        focused.length > 24000
    ) {
        focused =
            focused.slice(
                0,
                24000
            );
    }

    console.log(
        `Topic-focused context: ${focused.length} characters from ${source.length} total characters.`
    );

    return focused;
}


/* =========================================================
   REMOVE UNWANTED PREFIXES
========================================================= */

function removeUnwantedPrefixes(
    text
) {
    return cleanText(text)
        .replace(
            /^(explanation|answer|response|topic explanation)\s*:\s*/i,
            ''
        )
        .trim();
}


/* =========================================================
   COMMAND CHECK
========================================================= */

async function commandExists(
    command
) {
    try {
        await execFileP(
            command,
            ['-version'],
            {
                windowsHide:
                    true,
            }
        );

        return true;
    } catch {
        return false;
    }
}


/* =========================================================
   PDF TEXT EXTRACTION
========================================================= */

async function extractPdfText(
    filePath
) {
    let pdfParse = null;

    try {
        pdfParse =
            require(
                'pdf-parse'
            );
    } catch {
        throw new Error(
            'pdf-parse is not installed. Run: npm install pdf-parse'
        );
    }

    const buffer =
        fs.readFileSync(
            filePath
        );

    try {
        if (
            typeof pdfParse ===
            'function'
        ) {
            const result =
                await pdfParse(
                    buffer
                );

            const text =
                cleanText(
                    result?.text ||
                    ''
                );

            if (
                text.length > 20
            ) {
                return text;
            }
        }
    } catch (error) {
        console.log(
            'Classic pdf-parse extraction failed:',
            error.message
        );
    }

    try {
        if (
            pdfParse &&
            typeof pdfParse.PDFParse ===
            'function'
        ) {
            const parser =
                new pdfParse.PDFParse({
                    data:
                        buffer,
                });

            if (
                typeof parser.getText ===
                'function'
            ) {
                const result =
                    await parser.getText();

                const text =
                    cleanText(
                        typeof result ===
                            'string'
                            ? result
                            : result?.text ||
                            ''
                    );

                if (
                    text.length > 20
                ) {
                    return text;
                }
            }
        }
    } catch (error) {
        console.log(
            'New PDFParse extraction failed:',
            error.message
        );
    }

    return '';
}


/* =========================================================
   OCR FALLBACK
========================================================= */

async function extractPdfWithOcr(
    filePath
) {
    if (
        !fs.existsSync(
            TESSERACT_PATH
        )
    ) {
        return '';
    }

    if (
        !fs.existsSync(
            POPPLER_PATH
        )
    ) {
        return '';
    }

    const id =
        makeId('ocr');

    const outputPrefix =
        path.join(
            TEMP_DIR,
            id
        );

    try {
        await execFileP(
            POPPLER_PATH,
            [
                '-png',
                '-r',
                '130',
                filePath,
                outputPrefix,
            ],
            {
                windowsHide:
                    true,
                maxBuffer:
                    50 *
                    1024 *
                    1024,
            }
        );

        const files =
            fs.readdirSync(
                TEMP_DIR
            )
                .filter(
                    (name) =>
                        name.startsWith(
                            id
                        ) &&
                        name.endsWith(
                            '.png'
                        )
                )
                .sort();

        let fullText = '';

        for (
            const imageName of files
        ) {
            const imagePath =
                path.join(
                    TEMP_DIR,
                    imageName
                );

            try {
                const output =
                    await execFileP(
                        TESSERACT_PATH,
                        [
                            imagePath,
                            'stdout',
                            '-l',
                            'eng',
                        ],
                        {
                            windowsHide:
                                true,
                            maxBuffer:
                                20 *
                                1024 *
                                1024,
                        }
                    );

                fullText +=
                    '\n' +
                    (
                        output.stdout ||
                        ''
                    );
            } catch (error) {
                console.log(
                    'OCR page failed:',
                    error.message
                );
            }
        }

        return cleanText(
            fullText
        );
    } finally {
        for (
            const imageName of fs
                .readdirSync(
                    TEMP_DIR
                )
                .filter(
                    (name) =>
                        name.startsWith(
                            id
                        )
                )
        ) {
            try {
                fs.unlinkSync(
                    path.join(
                        TEMP_DIR,
                        imageName
                    )
                );
            } catch { }
        }
    }
}


/* =========================================================
   UPLOAD ROUTE
========================================================= */

app.post(
    '/upload',
    upload.single('file'),
    async (req, res) => {
        try {
            if (!req.file) {
                return res
                    .status(400)
                    .json({
                        success:
                            false,
                        error:
                            'No PDF file was uploaded.',
                    });
            }

            console.log(
                '\n============================================'
            );

            console.log(
                'PDF UPLOAD'
            );

            console.log(
                'File:',
                req.file.originalname
            );

            console.log(
                '============================================'
            );

            let text =
                await extractPdfText(
                    req.file.path
                );

            if (
                text.length < 50
            ) {
                console.log(
                    'Very little PDF text found. Trying OCR...'
                );

                const ocrText =
                    await extractPdfWithOcr(
                        req.file.path
                    );

                if (
                    ocrText.length >
                    text.length
                ) {
                    text =
                        ocrText;
                }
            }

            text =
                cleanText(text);

            if (!text) {
                return res
                    .status(422)
                    .json({
                        success:
                            false,
                        error:
                            'Could not extract readable text from this PDF.',
                    });
            }

            console.log(
                `Extracted ${text.length} characters.`
            );

            res.json({
                success:
                    true,

                filename:
                    req.file.filename,

                originalName:
                    req.file.originalname,

                text,

                characterCount:
                    text.length,

                wordCount:
                    wordCount(text),
            });
        } catch (error) {
            console.error(
                'UPLOAD ERROR:',
                error
            );

            res
                .status(500)
                .json({
                    success:
                        false,
                    error:
                        error.message ||
                        'PDF upload failed.',
                });
        }
    }
);


/* =========================================================
   OLLAMA
========================================================= */

async function callOllama({
    system,
    user,
    temperature = 0.15,
    numPredict = 3000,
}) {
    const controller =
        new AbortController();

    const timeout =
        setTimeout(
            () => {
                controller.abort();
            },
            180000
        );

    try {
        const response =
            await fetch(
                OLLAMA_URL,
                {
                    method:
                        'POST',

                    headers: {
                        'Content-Type':
                            'application/json',
                    },

                    body:
                        JSON.stringify({
                            model:
                                OLLAMA_MODEL,

                            stream:
                                false,

                            format:
                                'json',

                            options: {
                                temperature,

                                top_p:
                                    0.85,

                                num_ctx:
                                    8192,

                                num_predict:
                                    numPredict,
                            },

                            messages: [
                                {
                                    role:
                                        'system',
                                    content:
                                        system,
                                },

                                {
                                    role:
                                        'user',
                                    content:
                                        user,
                                },
                            ],
                        }),

                    signal:
                        controller.signal,
                }
            );

        if (
            !response.ok
        ) {
            const errorText =
                await response.text();

            throw new Error(
                `Ollama HTTP ${response.status}: ${errorText}`
            );
        }

        const data =
            await response.json();

        const content =
            data?.message?.content ||
            data?.response ||
            '';

        if (
            !content.trim()
        ) {
            throw new Error(
                'Ollama returned an empty response.'
            );
        }

        return content.trim();
    } finally {
        clearTimeout(
            timeout
        );
    }
}


/* =========================================================
   JSON EXTRACTION
========================================================= */

function extractJsonObject(
    raw
) {
    if (!raw) {
        return null;
    }

    let cleaned =
        String(raw)
            .replace(
                /```json/gi,
                ''
            )
            .replace(
                /```/g,
                ''
            )
            .trim();

    const first =
        cleaned.indexOf(
            '{'
        );

    const last =
        cleaned.lastIndexOf(
            '}'
        );

    if (
        first === -1 ||
        last === -1 ||
        last <= first
    ) {
        return null;
    }

    cleaned =
        cleaned.slice(
            first,
            last + 1
        );

    try {
        return JSON.parse(
            cleaned
        );
    } catch {
        return null;
    }
}


/* =========================================================
   VIDEO SCRIPT GENERATION
========================================================= */

async function generateVideoScript(
    text,
    topic
) {
    const cleanTopic =
        cleanText(topic);

    const material =
        buildTopicFocusedMaterial(
            text,
            cleanTopic
        );

    const systemPrompt = `
You are TeachBack, a focused educational AI tutor.

MOST IMPORTANT RULE:

Teach ONLY the exact topic requested by the learner.

REQUESTED TOPIC:

"${cleanTopic}"

This topic is the strict boundary of the lesson.

The supplied study material may contain many different topics.

Do NOT:

- summarize the entire PDF
- summarize the chapter
- summarize the unit
- explain neighboring topics
- explain unrelated topics
- give a broad subject overview
- add unrelated definitions
- move to another concept

Everything must directly help the learner understand:

"${cleanTopic}"

LANGUAGE:

English only.

Use natural Indian English.

Use simple college-level English.

TEACHING STYLE:

- simple
- clear
- natural
- human
- accurate
- no unnecessary repetition

Create exactly 6 scenes.

ALL SIX SCENES MUST TEACH THE SAME TOPIC.

Scene 1:
Meaning and purpose.

Scene 2:
First important part.

Scene 3:
Working/process.

Scene 4:
Simple concrete example.

Scene 5:
Another important topic-specific detail.

Scene 6:
Clear recap.

Combined narration:
approximately 320–380 words.

VISUALS:

Every scene needs its own visual idea.

Every visual must directly represent:

"${cleanTopic}"

Visuals must match the narration.

Do not use generic:

- students
- classrooms
- books
- laptops
- robots
- light bulbs
- generic connected circles

unless actually required by the exact topic.

Each visualPlan must describe a concrete educational diagram,
process, structure, graph, example, transformation,
comparison, formula, matrix, algorithm trace, scientific
structure, etc., based on the exact topic.

The six visual plans must be meaningfully different.

Return ONLY valid JSON.

{
  "title": "short topic title",
  "scenes": [
    {
      "title": "scene title",
      "narration": "spoken narration",
      "visualPlan": "specific visual for this scene"
    }
  ]
}

Before returning, verify:

1. All six scenes are about the exact topic.
2. No unrelated PDF topic is introduced.
3. The example is about the exact topic.
4. Every visualPlan is topic-specific.
5. Visual ideas are different.
`;

    const userPrompt = `
EXACT REQUESTED TOPIC:

${cleanTopic}

The learner wants ONLY this topic:

"${cleanTopic}"

FOCUSED STUDY MATERIAL:

${material}

Create exactly 6 scenes.

Keep the complete lesson strictly about:

"${cleanTopic}"
`;

    let raw = '';

    try {
        raw =
            await callOllama({
                system:
                    systemPrompt,

                user:
                    userPrompt,

                temperature:
                    0.10,

                numPredict:
                    4000,
            });
    } catch (error) {
        console.error(
            'First Ollama call failed:',
            error.message
        );

        throw new Error(
            `Lesson generation failed: ${error.message}`
        );
    }

    let lesson =
        extractJsonObject(
            raw
        );

    if (!lesson) {
        console.log(
            'First lesson JSON invalid. Retrying...'
        );

        try {
            const retryRaw =
                await callOllama({
                    system: `
You are TeachBack.

Teach ONLY:

"${cleanTopic}"

Create exactly 6 scenes.

Use simple natural Indian English.

Do not explain the chapter or PDF.

Do not explain unrelated concepts.

All six scenes must be about:

"${cleanTopic}"

Required:

1. Meaning
2. Important part
3. Working
4. Example
5. Important detail
6. Recap

Every scene must contain:
title
narration
visualPlan

Return ONLY valid JSON.

{
  "title": "...",
  "scenes": [
    {
      "title": "...",
      "narration": "...",
      "visualPlan": "..."
    }
  ]
}
`,

                    user:
                        `
Exact topic:

${cleanTopic}

Study material:

${material.slice(
                            0,
                            22000
                        )}

Teach only this topic.
`,

                    temperature:
                        0.05,

                    numPredict:
                        4000,
                });

            lesson =
                extractJsonObject(
                    retryRaw
                );
        } catch (error) {
            throw new Error(
                `Lesson retry failed: ${error.message}`
            );
        }
    }

    if (!lesson) {
        throw new Error(
            'Incomplete lesson returned by Ollama.'
        );
    }

    if (
        !Array.isArray(
            lesson.scenes
        )
    ) {
        throw new Error(
            'Ollama did not return scenes.'
        );
    }

    const validScenes =
        lesson.scenes
            .filter(
                (scene) =>
                    scene &&
                    typeof scene ===
                    'object' &&
                    typeof scene.title ===
                    'string' &&
                    typeof scene.narration ===
                    'string' &&
                    scene.narration
                        .trim()
                        .length > 20
            )
            .slice(
                0,
                6
            )
            .map(
                (
                    scene,
                    index
                ) => ({
                    title:
                        scene.title
                            .trim() ||
                        `Scene ${index + 1}`,

                    narration:
                        removeUnwantedPrefixes(
                            scene.narration
                        ),

                    visualPlan:
                        typeof scene.visualPlan ===
                            'string' &&
                            scene.visualPlan
                                .trim()
                            ? scene.visualPlan.trim()
                            : `Create a clear educational visual specifically explaining ${cleanTopic}.`,
                })
            );

    if (
        validScenes.length < 4
    ) {
        throw new Error(
            `Only ${validScenes.length} usable scenes were returned.`
        );
    }

    lesson.scenes =
        validScenes;

    lesson.title =
        typeof lesson.title ===
            'string' &&
            lesson.title.trim()
            ? lesson.title.trim()
            : `Understanding ${cleanTopic}`;

    console.log(
        `Created ${lesson.scenes.length} topic-focused scenes.`
    );

    return lesson;
}


/* =========================================================
   EXPLANATION
========================================================= */

async function generateExplanation(
    text,
    topic
) {
    const cleanTopic =
        cleanText(topic);

    const material =
        buildTopicFocusedMaterial(
            text,
            cleanTopic
        );

    const system = `
You are TeachBack.

Explain ONLY this exact topic:

"${cleanTopic}"

Do not summarize the PDF.

Do not summarize the chapter.

Do not discuss unrelated concepts.

Use:

- simple English
- natural Indian English
- clear college-level language
- short paragraphs
- simple examples

Explain:

1. Meaning
2. Main idea
3. Important parts
4. Working or steps
5. Simple example
6. One useful detail
7. Short recap

Everything must directly relate to:

"${cleanTopic}"

Return ONLY JSON:

{
  "explanation": "...",
  "example": "...",
  "recap": "..."
}
`;

    const user = `
EXACT TOPIC:

${cleanTopic}

FOCUSED STUDY MATERIAL:

${material}

Explain ONLY:

${cleanTopic}
`;

    let raw;

    try {
        raw =
            await callOllama({
                system,

                user,

                temperature:
                    0.12,

                numPredict:
                    2200,
            });
    } catch (error) {
        throw new Error(
            `Explanation generation failed: ${error.message}`
        );
    }

    let result =
        extractJsonObject(
            raw
        );

    if (!result) {
        const retryRaw =
            await callOllama({
                system: `
Return ONLY JSON.

Explain ONLY:

"${cleanTopic}"

Use simple English and natural Indian English.

Required:

{
  "explanation": "...",
  "example": "...",
  "recap": "..."
}
`,

                user:
                    `
Topic:

${cleanTopic}

Material:

${material.slice(
                        0,
                        22000
                    )}
`,

                temperature:
                    0.05,

                numPredict:
                    2200,
            });

        result =
            extractJsonObject(
                retryRaw
            );
    }

    if (!result) {
        throw new Error(
            'Ollama returned an incomplete explanation.'
        );
    }

    return {
        explanation:
            removeUnwantedPrefixes(
                result.explanation ||
                ''
            ),

        example:
            removeUnwantedPrefixes(
                result.example ||
                ''
            ),

        recap:
            removeUnwantedPrefixes(
                result.recap ||
                ''
            ),
    };
}



/* =========================================================
   TEACHBACK UNDERSTANDING EVALUATION
========================================================= */

async function evaluateTeachBack({
    text,
    topic,
    studentAnswer,
    explanation,
    example,
    recap,
}) {
    const cleanTopic = cleanText(topic);
    const cleanStudentAnswer = cleanText(studentAnswer);

    if (!cleanStudentAnswer) {
        throw new Error('Student explanation is required.');
    }

    const material = buildTopicFocusedMaterial(text, cleanTopic);

    const system = `
You are the TeachBack understanding evaluator.

Your job is to evaluate whether a college student actually understands the EXACT topic they were asked to learn.

EXACT TOPIC:
"${cleanTopic}"

IMPORTANT RULES:
1. Evaluate ONLY the exact topic above.
2. Do not judge grammar, spelling, accent, or English fluency.
3. Focus only on conceptual understanding.
4. Accept correct explanations written in the student's own words.
5. Do not penalize a short answer if it demonstrates the important concept.
6. Identify misconceptions clearly.
7. Do not introduce unrelated concepts.
8. Do not evaluate knowledge outside the exact requested topic.
9. Be encouraging but honest.
10. Use simple English and natural Indian English.
11. Never insult the student.

Determine:
- what the student understood correctly
- what the student partially understood
- what important points are missing
- whether there are conceptual mistakes

Use exactly one of these overall results:
"Good understanding"
"Partial understanding"
"Needs improvement"

Good understanding means the student correctly explains the main concept and most important points without a major conceptual mistake.

Partial understanding means the student understands some important parts but has missing points or minor conceptual confusion.

Needs improvement means the student has a major misunderstanding, gives an unrelated answer, or does not demonstrate understanding of the requested topic.

Return ONLY valid JSON in this exact structure:
{
  "overall": "Good understanding | Partial understanding | Needs improvement",
  "understood": ["..."],
  "partial": ["..."],
  "missing": ["..."],
  "correction": "...",
  "betterExplanation": "...",
  "retryPrompt": "..."
}
`;

    const user = `
EXACT TOPIC:
${cleanTopic}

FOCUSED STUDY MATERIAL:
${material}

TEACHBACK EXPLANATION:
${cleanText(explanation || '')}

EXAMPLE:
${cleanText(example || '')}

RECAP:
${cleanText(recap || '')}

STUDENT'S OWN EXPLANATION:
${cleanStudentAnswer}

Evaluate the student's understanding of ONLY this exact topic:
${cleanTopic}
`;

    let raw;

    try {
        raw = await callOllama({
            system,
            user,
            temperature: 0.08,
            numPredict: 1800,
        });
    } catch (error) {
        throw new Error(
            `Understanding evaluation failed: ${error.message}`
        );
    }

    let result = extractJsonObject(raw);

    if (!result) {
        const retryRaw = await callOllama({
            system: `
Return ONLY valid JSON.

Evaluate the student's conceptual understanding of this exact topic:
"${cleanTopic}"

Do not evaluate grammar or English fluency.
Do not evaluate unrelated knowledge.

Required JSON:
{
  "overall": "Good understanding | Partial understanding | Needs improvement",
  "understood": [],
  "partial": [],
  "missing": [],
  "correction": "",
  "betterExplanation": "",
  "retryPrompt": ""
}
`,
            user: `
Topic:
${cleanTopic}

Focused study material:
${material.slice(0, 22000)}

Student answer:
${cleanStudentAnswer}
`,
            temperature: 0.05,
            numPredict: 1800,
        });

        result = extractJsonObject(retryRaw);
    }

    if (!result) {
        throw new Error(
            'Ollama returned an incomplete understanding evaluation.'
        );
    }

    const allowedOverall = [
        'Good understanding',
        'Partial understanding',
        'Needs improvement',
    ];

    let overall = String(result.overall || '').trim();

    if (!allowedOverall.includes(overall)) {
        overall = 'Partial understanding';
    }

    const toCleanArray = (value) => {
        if (!Array.isArray(value)) {
            return [];
        }

        return value
            .map(item =>
                removeUnwantedPrefixes(String(item || ''))
            )
            .filter(Boolean)
            .slice(0, 8);
    };

    return {
        overall,
        understood: toCleanArray(result.understood),
        partial: toCleanArray(result.partial),
        missing: toCleanArray(result.missing),
        correction: removeUnwantedPrefixes(
            String(result.correction || '')
        ),
        betterExplanation: removeUnwantedPrefixes(
            String(result.betterExplanation || '')
        ),
        retryPrompt: removeUnwantedPrefixes(
            String(
                result.retryPrompt ||
                `Now explain ${cleanTopic} again in your own words.`
            )
        ),
    };
}


/* =========================================================
   TEACHBACK EVALUATION ROUTE
========================================================= */

app.post(
    '/evaluate',
    async (req, res) => {
        try {
            const {
                text,
                topic,
                studentAnswer,
                explanation,
                example,
                recap,
            } = req.body;

            if (!text || !String(text).trim()) {
                return res.status(400).json({
                    success: false,
                    error: 'Study material is missing.',
                });
            }

            if (!topic || !String(topic).trim()) {
                return res.status(400).json({
                    success: false,
                    error: 'Topic is required.',
                });
            }

            if (!studentAnswer || !String(studentAnswer).trim()) {
                return res.status(400).json({
                    success: false,
                    error: 'Please explain the topic in your own words first.',
                });
            }

            const result = await evaluateTeachBack({
                text,
                topic: topic.trim(),
                studentAnswer: studentAnswer.trim(),
                explanation: explanation || '',
                example: example || '',
                recap: recap || '',
            });

            res.json({
                success: true,
                topic: topic.trim(),
                language: 'english',
                ...result,
            });
        } catch (error) {
            console.error(
                'TEACHBACK EVALUATION ERROR:',
                error
            );

            res.status(500).json({
                success: false,
                error:
                    error.message ||
                    'Understanding evaluation failed.',
            });
        }
    }
);


/* =========================================================
   EXPLAIN ROUTE
========================================================= */

app.post(
    '/explain',
    async (req, res) => {
        try {
            const {
                text,
                topic,
            } = req.body;

            if (
                !text ||
                !String(text).trim()
            ) {
                return res
                    .status(400)
                    .json({
                        success:
                            false,
                        error:
                            'Study material is missing.',
                    });
            }

            if (
                !topic ||
                !String(topic).trim()
            ) {
                return res
                    .status(400)
                    .json({
                        success:
                            false,
                        error:
                            'Topic is required.',
                    });
            }

            const result =
                await generateExplanation(
                    text,
                    topic.trim()
                );

            res.json({
                success:
                    true,

                topic:
                    topic.trim(),

                language:
                    'english',

                ...result,
            });
        } catch (error) {
            console.error(
                'EXPLAIN ERROR:',
                error
            );

            res
                .status(500)
                .json({
                    success:
                        false,
                    error:
                        error.message ||
                        'Explanation generation failed.',
                });
        }
    }
);


/* =========================================================
   SVG HELPERS
========================================================= */

function escapeXml(text) {
    return String(
        text || ''
    )
        .replace(
            /&/g,
            '&amp;'
        )
        .replace(
            /</g,
            '&lt;'
        )
        .replace(
            />/g,
            '&gt;'
        )
        .replace(
            /"/g,
            '&quot;'
        )
        .replace(
            /'/g,
            '&apos;'
        );
}


function wrapText(
    text,
    maxChars = 34
) {
    const words =
        String(text || '')
            .split(/\s+/)
            .filter(Boolean);

    const lines = [];

    let current = '';

    for (
        const word of words
    ) {
        if (
            `${current} ${word}`
                .trim()
                .length >
            maxChars
        ) {
            if (current) {
                lines.push(
                    current.trim()
                );
            }

            current =
                word;
        } else {
            current =
                `${current} ${word}`
                    .trim();
        }
    }

    if (current) {
        lines.push(
            current.trim()
        );
    }

    return lines.slice(
        0,
        6
    );
}


/* =========================================================
   UNIQUE VISUAL SEED
========================================================= */

function createVisualSeed(
    topic,
    scene,
    sceneIndex
) {
    const source =
        [
            topic,
            scene?.title || '',
            scene?.narration || '',
            scene?.visualPlan || '',
            String(sceneIndex),
        ].join('|');

    return crypto
        .createHash('sha256')
        .update(source)
        .digest('hex')
        .slice(
            0,
            16
        );
}


/* =========================================================
   NORMALIZE SVG
========================================================= */

function normalizeGeneratedSvg(
    rawSvg
) {
    if (
        typeof rawSvg !==
        'string'
    ) {
        return null;
    }

    let svg =
        rawSvg
            .trim()
            .replace(
                /^```svg\s*/i,
                ''
            )
            .replace(
                /^```\s*/i,
                ''
            )
            .replace(
                /\s*```$/i,
                ''
            )
            .trim();

    const svgStart =
        svg.indexOf(
            '<svg'
        );

    const svgEnd =
        svg.lastIndexOf(
            '</svg>'
        );

    if (
        svgStart === -1 ||
        svgEnd === -1 ||
        svgEnd <= svgStart
    ) {
        return null;
    }

    svg =
        svg.slice(
            svgStart,
            svgEnd + 6
        );

    /*
     * Remove dangerous/problematic constructs.
     */
    svg =
        svg
            .replace(
                /<script[\s\S]*?<\/script>/gi,
                ''
            )
            .replace(
                /<foreignObject[\s\S]*?<\/foreignObject>/gi,
                ''
            )
            .replace(
                /<iframe[\s\S]*?<\/iframe>/gi,
                ''
            )
            .replace(
                /<image[\s\S]*?>/gi,
                ''
            )
            .replace(
                /<style[\s\S]*?<\/style>/gi,
                ''
            );

    /*
     * Force canvas dimensions.
     */
    svg =
        svg.replace(
            /<svg\b([^>]*)>/i,
            (match, attributes) => {
                const updated =
                    attributes
                        .replace(
                            /\swidth\s*=\s*["'][^"']*["']/gi,
                            ''
                        )
                        .replace(
                            /\sheight\s*=\s*["'][^"']*["']/gi,
                            ''
                        )
                        .replace(
                            /\sviewBox\s*=\s*["'][^"']*["']/gi,
                            ''
                        );

                return (
                    `<svg${updated} ` +
                    `width="570" ` +
                    `height="850" ` +
                    `viewBox="0 0 570 850">`
                );
            }
        );

    if (
        !svg.startsWith(
            '<svg'
        )
    ) {
        return null;
    }

    if (
        !svg.includes(
            '</svg>'
        )
    ) {
        return null;
    }

    return svg;
}


/* =========================================================
   VISUAL GENERATION
   EXACT-TOPIC STRUCTURED EDUCATIONAL VISUALS

   IMPORTANT:
   - Only this visual-generation section is changed.
   - Ollama creates a compact semantic visual specification.
   - JavaScript renders the final SVG locally.
   - This avoids generic/malformed LLM-generated SVGs.
   - Every scene gets a different topic-specific composition.
========================================================= */

function escapeXml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function visualWords(text, max = 8) {
    return cleanText(text)
        .replace(/[^a-zA-Z0-9\s-]/g, ' ')
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, max);
}

function createVisualSeed(topic, scene, sceneIndex) {
    return crypto
        .createHash('sha256')
        .update(
            `${cleanText(topic)}|${sceneIndex}|${cleanText(scene?.title || '')}|${cleanText(scene?.narration || '')}|${cleanText(scene?.visualPlan || '')}`
        )
        .digest('hex')
        .slice(0, 16);
}

function svgTextLines(text, x, y, maxChars, lineHeight, attrs = '') {
    const words = cleanText(text).split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';

    for (const word of words) {
        const candidate = line ? `${line} ${word}` : word;
        if (candidate.length > maxChars && line) {
            lines.push(line);
            line = word;
        } else {
            line = candidate;
        }
    }

    if (line) lines.push(line);

    return lines
        .slice(0, 6)
        .map((lineText, i) =>
            `<text x="${x}" y="${y + i * lineHeight}" ${attrs}>${escapeXml(lineText)}</text>`
        )
        .join('');
}

function normalizeVisualSpec(value) {
    if (!value || typeof value !== 'object') return null;

    const allowedTypes = new Set([
        'process',
        'cycle',
        'flowchart',
        'structure',
        'comparison',
        'algorithm',
        'matrix',
        'equation',
        'graph',
        'timeline',
        'anatomy',
        'system',
        'table',
        'sequence',
        'cause_effect',
        'concept_map',
    ]);

    const visualType = String(value.visualType || '').toLowerCase().trim();

    return {
        visualType: allowedTypes.has(visualType) ? visualType : 'process',
        heading: cleanText(value.heading || ''),
        subtitle: cleanText(value.subtitle || ''),
        mainIdea: cleanText(value.mainIdea || ''),
        labels: Array.isArray(value.labels)
            ? value.labels.map(x => cleanText(x)).filter(Boolean).slice(0, 10)
            : [],
        steps: Array.isArray(value.steps)
            ? value.steps.map(x => cleanText(x)).filter(Boolean).slice(0, 8)
            : [],
        inputs: Array.isArray(value.inputs)
            ? value.inputs.map(x => cleanText(x)).filter(Boolean).slice(0, 6)
            : [],
        outputs: Array.isArray(value.outputs)
            ? value.outputs.map(x => cleanText(x)).filter(Boolean).slice(0, 6)
            : [],
        examples: Array.isArray(value.examples)
            ? value.examples.map(x => cleanText(x)).filter(Boolean).slice(0, 8)
            : [],
        relations: Array.isArray(value.relations)
            ? value.relations
                .map(r => ({
                    from: cleanText(r?.from || ''),
                    to: cleanText(r?.to || ''),
                    label: cleanText(r?.label || ''),
                }))
                .filter(r => r.from && r.to)
                .slice(0, 10)
            : [],
        formula: cleanText(value.formula || ''),
        keywords: Array.isArray(value.keywords)
            ? value.keywords.map(x => cleanText(x)).filter(Boolean).slice(0, 8)
            : [],
        tableHeaders: Array.isArray(value.tableHeaders)
            ? value.tableHeaders.map(x => cleanText(x)).filter(Boolean).slice(0, 5)
            : [],
        tableRows: Array.isArray(value.tableRows)
            ? value.tableRows
                .map(row => Array.isArray(row) ? row.map(x => cleanText(x)).filter(Boolean).slice(0, 5) : [])
                .filter(row => row.length)
                .slice(0, 6)
            : [],
    };
}

async function generateVisualSpec(scene, topic, sceneIndex, totalScenes) {
    const cleanTopic = cleanText(topic);
    const sceneTitle = cleanText(scene?.title || '');
    const narration = cleanText(scene?.narration || '');
    const visualPlan = cleanText(scene?.visualPlan || '');
    const seed = createVisualSeed(topic, scene, sceneIndex);

    const system = `
You are TeachBack's EXACT-TOPIC educational visual planner.

Your job is NOT to draw an SVG.
Your job is to convert the exact lesson scene into a compact structured
visual specification that a local renderer will turn into an educational diagram.

EXACT TOPIC:
${cleanTopic}

SCENE ${sceneIndex + 1} OF ${totalScenes}
TITLE:
${sceneTitle}

NARRATION:
${narration}

VISUAL PLAN:
${visualPlan}

UNIQUE SCENE SEED:
${seed}

============================================================
NON-NEGOTIABLE TOPIC RULE
============================================================

Every visual element MUST teach the exact topic above or a direct
sub-part/process/example of that topic.

Do NOT use generic educational imagery such as students, classrooms,
books, laptops, robots, light bulbs, generic circles, generic icons,
random arrows, or decorative symbols unless the exact topic requires them.

Use the actual academic objects, terms, steps, structures, equations,
examples, data, diagrams, tokens, matrices, biological structures,
engineering components, or processes relevant to the topic.

Examples:

PHOTOSYNTHESIS:
Use a plant/leaf, sunlight, water, carbon dioxide, chloroplast,
glucose and oxygen, with arrows showing the photosynthesis process.
Do not use a generic science icon.

SOBEL EDGE DETECTION:
Use a small pixel matrix, Sobel Gx/Gy kernels, convolution,
gradients and an edge result.

CANNY EDGE DETECTION:
Show the actual sequence such as smoothing, gradient,
non-maximum suppression, double threshold and edge tracking.

BINARY SEARCH:
Show a sorted array, low/high/mid, comparison with target,
and the discarded half.

BUBBLE SORT:
Show an array and adjacent comparisons/swaps across passes.

POS TAGGING:
Show actual sentence tokens and their grammatical tags.

STEMMING:
Show real words and suffix removal leading to a stem.

COMPILER:
Show the relevant compiler stages or structures such as source,
tokens, syntax tree, intermediate representation, optimization,
or target code depending on the scene.

DATABASE NORMALIZATION:
Show a concrete relation/table, dependencies, keys, and decomposition
when those are part of the scene.

QUANTUM COHERENCE/DECOHERENCE:
Show quantum states/system, coherent phase relationship, environment
interaction and loss of coherence when those concepts are being taught.

For ANY other topic, infer the actual academic objects from the
narration and visual plan. Never fall back to generic artwork.

============================================================
SCENE DIFFERENTIATION
============================================================

Do not repeat one composition across all six scenes.
Choose the visualType and data for THIS scene.
Examples:
- definition scene -> structure/concept_map
- components scene -> anatomy/system
- step-by-step mechanism -> process/flowchart
- worked example -> algorithm/table/matrix/equation
- comparison -> comparison/table
- stages -> timeline/sequence
- mathematical operation -> equation/matrix/graph

The visualType must match the academic content.

============================================================
DATA QUALITY
============================================================

Use concise real content from the supplied narration/visual plan.
Do not invent unrelated facts.
If an exact value or example is not supplied, use a simple illustrative
example only when it is standard for the topic and clearly useful.

For diagrams, use specific labels instead of vague labels such as
"Step 1", "Thing", "Concept", "Input", "Output" unless those are
actually meaningful for the exact topic.

============================================================
RETURN ONLY VALID JSON
============================================================

{
  "visualType": "process|cycle|flowchart|structure|comparison|algorithm|matrix|equation|graph|timeline|anatomy|system|table|sequence|cause_effect|concept_map",
  "heading": "short exact-topic heading",
  "subtitle": "short scene-specific description",
  "mainIdea": "one concise statement",
  "labels": ["actual topic-specific labels"],
  "steps": ["actual topic-specific steps"],
  "inputs": ["actual topic-specific inputs"],
  "outputs": ["actual topic-specific outputs"],
  "examples": ["actual topic-specific examples"],
  "relations": [
    {"from":"actual object", "to":"actual object", "label":"why/how"}
  ],
  "formula": "formula only when relevant",
  "keywords": ["topic-specific keywords"],
  "tableHeaders": ["headers when relevant"],
  "tableRows": [["row values when relevant"]]
}

Return JSON only. No markdown. No SVG. No explanation.
`;

    const user = `
Build the visual specification for THIS exact scene.

Exact topic: ${cleanTopic}
Scene: ${sceneIndex + 1}/${totalScenes}
Title: ${sceneTitle}
Narration: ${narration}
Visual plan: ${visualPlan}

The final diagram must visibly teach the exact topic, not merely display
the topic name. Return only the JSON object.
`;

    try {
        const raw = await callOllama({
            system,
            user,
            temperature: 0.05,
            numPredict: 1800,
        });

        const spec = normalizeVisualSpec(extractJsonObject(raw));

        if (!spec) {
            console.warn('Visual specification was not valid JSON/object.');
            return null;
        }

        if (!visualSpecMatchesExactTopic(spec, cleanTopic, scene)) {
            console.warn('Visual specification did not match the exact topic. Falling back to topic-specific rendering.');
            return null;
        }

        if (visualSpecIsGeneric(spec)) {
            console.warn('Visual specification was too generic. Falling back to topic-specific rendering.');
            return null;
        }

        // Always put the exact topic into the scene heading so the rendered
        // visual remains visibly anchored to the requested topic.
        spec.heading = cleanText(spec.heading || cleanTopic);
        if (!spec.heading.toLowerCase().includes(cleanTopic.toLowerCase())) {
            spec.heading = cleanTopic;
        }

        return spec;
    } catch (error) {
        console.error('Visual specification generation failed:', error.message);
        return null;
    }
}


function visualSpecMatchesExactTopic(spec, topic, scene) {
    if (!spec || !topic) return false;

    const exactTopic = cleanText(topic).toLowerCase();
    const sceneText = [
        spec.heading,
        spec.subtitle,
        spec.mainIdea,
        ...(spec.labels || []),
        ...(spec.steps || []),
        ...(spec.inputs || []),
        ...(spec.outputs || []),
        ...(spec.examples || []),
        ...(spec.keywords || []),
        ...(spec.tableHeaders || []),
        ...(spec.tableRows || []).flat(),
        ...(spec.relations || []).flatMap(r => [r.from, r.to, r.label]),
        spec.formula,
        scene?.title || '',
        scene?.visualPlan || ''
    ].join(' ').toLowerCase();

    // The exact topic must appear in the semantic specification or scene context.
    if (exactTopic && sceneText.includes(exactTopic)) return true;

    // For multi-word topics, accept strong word overlap but reject unrelated visuals.
    const topicTokens = exactTopic
        .replace(/[^a-z0-9\s-]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length >= 3);

    if (!topicTokens.length) return true;

    const matched = topicTokens.filter(token => sceneText.includes(token));
    const overlap = matched.length / topicTokens.length;

    // Single-word topics need an exact semantic occurrence.
    if (topicTokens.length === 1) return overlap === 1;

    return overlap >= 0.6;
}

function visualSpecIsGeneric(spec) {
    if (!spec) return true;

    const combined = [
        spec.heading,
        spec.subtitle,
        spec.mainIdea,
        ...(spec.labels || []),
        ...(spec.steps || []),
        ...(spec.inputs || []),
        ...(spec.outputs || []),
        ...(spec.examples || []),
        ...(spec.keywords || [])
    ].join(' ').toLowerCase();

    const genericOnly = [
        'student',
        'classroom',
        'school',
        'book',
        'laptop',
        'robot',
        'light bulb',
        'learning',
        'education',
        'teacher',
        'generic',
        'random'
    ];

    const meaningfulTopicContent = [
        ...(spec.labels || []),
        ...(spec.steps || []),
        ...(spec.inputs || []),
        ...(spec.outputs || []),
        ...(spec.examples || []),
        ...(spec.keywords || [])
    ].filter(Boolean).length;

    const genericHits = genericOnly.filter(word => combined.includes(word)).length;

    return meaningfulTopicContent === 0 ||
        (genericHits >= 2 && meaningfulTopicContent <= 3);
}

function topicAwareFallbackSpec(scene, topic, sceneIndex) {
    const t = cleanText(topic).toLowerCase();
    const title = cleanText(scene?.title || topic);
    const narration = cleanText(scene?.narration || '');
    const plan = cleanText(scene?.visualPlan || '');
    const combined = `${t} ${title.toLowerCase()} ${narration.toLowerCase()} ${plan.toLowerCase()}`;

    if (combined.includes('photosynthesis')) {
        return normalizeVisualSpec({
            visualType: 'process',
            heading: 'Photosynthesis',
            subtitle: 'How a plant converts light energy into food',
            mainIdea: 'Light energy drives the conversion of carbon dioxide and water into glucose and oxygen.',
            inputs: ['Sunlight', 'Carbon dioxide (CO₂)', 'Water (H₂O)'],
            steps: ['Light reaches the leaf', 'Chloroplasts capture light energy', 'CO₂ and H₂O are processed', 'Glucose is produced and O₂ is released'],
            outputs: ['Glucose (C₆H₁₂O₆)', 'Oxygen (O₂)'],
            labels: ['Leaf', 'Chloroplast', 'Sunlight', 'CO₂', 'H₂O', 'Glucose', 'O₂'],
            formula: '6CO₂ + 6H₂O + light → C₆H₁₂O₆ + 6O₂',
            keywords: ['photosynthesis', 'chloroplast', 'glucose', 'oxygen'],
        });
    }

    if (combined.includes('binary search')) {
        return normalizeVisualSpec({
            visualType: 'algorithm',
            heading: 'Binary Search',
            subtitle: 'Search a sorted array by repeatedly halving the range',
            mainIdea: 'Compare the target with the middle value and discard the half that cannot contain the target.',
            labels: ['Sorted array', 'Low', 'Mid', 'High', 'Target', 'Discarded half'],
            steps: ['Choose the middle element', 'Compare mid with target', 'Discard the impossible half', 'Repeat on the remaining half'],
            examples: ['[10, 20, 30, 40, 50, 60, 70]', 'Target = 60'],
            keywords: ['sorted array', 'middle', 'target', 'search range'],
        });
    }

    if (combined.includes('bubble sort')) {
        return normalizeVisualSpec({
            visualType: 'algorithm',
            heading: 'Bubble Sort',
            subtitle: 'Adjacent values are compared and swapped',
            mainIdea: 'Repeated adjacent comparisons move larger values toward the end of the array.',
            labels: ['Array', 'Compare', 'Swap', 'Sorted portion'],
            steps: ['Compare adjacent values', 'Swap when left value is larger', 'Continue through the pass', 'Repeat until sorted'],
            examples: ['[5, 2, 4, 1]', '5 > 2 → swap'],
            keywords: ['adjacent', 'comparison', 'swap', 'pass'],
        });
    }

    if (combined.includes('sobel')) {
        return normalizeVisualSpec({
            visualType: 'matrix',
            heading: 'Sobel Edge Detection',
            subtitle: 'Detect intensity changes using horizontal and vertical kernels',
            mainIdea: 'Sobel kernels measure horizontal and vertical intensity changes to highlight edges.',
            labels: ['Pixel matrix', 'Gx kernel', 'Gy kernel', 'Convolution', 'Gradient', 'Edge'],
            steps: ['Take a local pixel neighbourhood', 'Apply Gx', 'Apply Gy', 'Combine gradient strength', 'Mark strong changes as edges'],
            examples: ['Gx = [-1 0 1; -2 0 2; -1 0 1]', 'Gy = [-1 -2 -1; 0 0 0; 1 2 1]'],
            keywords: ['pixel', 'kernel', 'Gx', 'Gy', 'gradient', 'edge'],
        });
    }

    if (combined.includes('canny')) {
        return normalizeVisualSpec({
            visualType: 'sequence',
            heading: 'Canny Edge Detection',
            subtitle: 'A multi-stage method for producing clean edges',
            mainIdea: 'The image is processed through several stages before final edge tracking.',
            steps: ['Gaussian smoothing', 'Gradient calculation', 'Non-maximum suppression', 'Double threshold', 'Edge tracking by hysteresis'],
            labels: ['Input image', 'Smoothed image', 'Gradient', 'Thin edges', 'Strong/weak edges', 'Final edges'],
            keywords: ['Gaussian', 'gradient', 'non-maximum suppression', 'threshold', 'hysteresis'],
        });
    }

    if (combined.includes('stemming')) {
        return normalizeVisualSpec({
            visualType: 'process',
            heading: 'Stemming',
            subtitle: 'Reducing related words to a common stem',
            mainIdea: 'A stemming algorithm removes word endings to obtain a common stem.',
            labels: ['playing', 'played', 'plays', 'play'],
            steps: ['Identify word ending', 'Remove suffix', 'Keep the remaining stem'],
            examples: ['playing → play', 'played → play', 'plays → play'],
            keywords: ['word', 'suffix', 'stem'],
        });
    }

    if (combined.includes('pos tagging') || combined.includes('part of speech')) {
        return normalizeVisualSpec({
            visualType: 'sequence',
            heading: 'POS Tagging',
            subtitle: 'Assigning a grammatical tag to each token',
            mainIdea: 'A sentence is split into tokens and each token receives a part-of-speech label.',
            labels: ['The', 'cat', 'runs'],
            steps: ['Tokenize sentence', 'Identify grammatical role', 'Assign POS tag'],
            examples: ['The → DET', 'cat → NOUN', 'runs → VERB'],
            keywords: ['token', 'NOUN', 'VERB', 'DET'],
        });
    }

    if (combined.includes('histogram equalization')) {
        return normalizeVisualSpec({
            visualType: 'comparison',
            heading: 'Histogram Equalization',
            subtitle: 'Redistributing intensities to improve contrast',
            mainIdea: 'The intensity distribution is transformed so useful intensity levels occupy a wider range.',
            labels: ['Original image', 'Original histogram', 'Equalized image', 'Equalized histogram'],
            steps: ['Count intensity frequencies', 'Build cumulative distribution', 'Map old intensities to new values', 'Obtain improved contrast'],
            keywords: ['intensity', 'histogram', 'CDF', 'contrast'],
        });
    }

    if (combined.includes('erosion') || combined.includes('dilation') || combined.includes('morphological')) {
        return normalizeVisualSpec({
            visualType: 'comparison',
            heading: cleanText(topic),
            subtitle: 'Morphological operation on a binary image',
            mainIdea: 'A structuring element changes the shape of foreground regions.',
            labels: ['Input image', 'Structuring element', 'Output image'],
            steps: combined.includes('erosion')
                ? ['Place structuring element', 'Check full fit', 'Keep matching centre pixels']
                : ['Place structuring element', 'Check neighbourhood', 'Set centre when required pixels are present'],
            keywords: ['binary image', 'structuring element', 'morphology'],
        });
    }

    if (combined.includes('fourier') || combined.includes('dft')) {
        return normalizeVisualSpec({
            visualType: 'process',
            heading: cleanText(topic),
            subtitle: 'Transforming an image or signal into frequency components',
            mainIdea: 'The transform represents spatial or time information using frequency components.',
            inputs: ['Input signal/image'],
            steps: ['Represent input samples', 'Apply transform', 'Obtain frequency components', 'Analyse frequency content'],
            outputs: ['Frequency-domain representation'],
            formula: 'F(u) = Σ f(x)e⁻ʲ²πux/N',
            keywords: ['frequency', 'transform', 'spectrum'],
        });
    }

    if (combined.includes('quantum coherence') || combined.includes('decoherence')) {
        return normalizeVisualSpec({
            visualType: 'cause_effect',
            heading: cleanText(topic),
            subtitle: 'How interaction with the environment changes quantum coherence',
            mainIdea: 'A coherent quantum state has a stable phase relationship; environmental interaction can reduce that coherence.',
            labels: ['Quantum state', 'Phase relationship', 'Environment', 'Interaction', 'Reduced coherence'],
            steps: ['Prepare coherent state', 'Maintain phase relationship', 'Interact with environment', 'Lose phase information'],
            keywords: ['quantum state', 'phase', 'environment', 'coherence'],
        });
    }

    const words = visualWords(`${topic} ${title}`, 7);
    return normalizeVisualSpec({
        visualType: sceneIndex % 3 === 0 ? 'process' : sceneIndex % 3 === 1 ? 'structure' : 'concept_map',
        heading: cleanText(topic),
        subtitle: title,
        mainIdea: narration.slice(0, 180),
        labels: words,
        steps: [
            title || cleanText(topic),
            ...visualWords(plan, 5),
        ].filter(Boolean).slice(0, 6),
        keywords: topicWordsForFallback(topic),
    });
}

function topicWordsForFallback(topic) {
    return topicKeywords(topic).slice(0, 8);
}

function roundedBox(x, y, w, h, title, body, accent = '#38bdf8') {
    const bodyText = cleanText(body);
    return `
<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="18" fill="#0f172a" stroke="#334155" stroke-width="2"/>
<rect x="${x}" y="${y}" width="6" height="${h}" rx="3" fill="${accent}"/>
<text x="${x + 22}" y="${y + 34}" fill="#f8fafc" font-size="16" font-weight="700">${escapeXml(title)}</text>
${svgTextLines(bodyText, x + 22, y + 62, Math.max(18, Math.floor(w / 8)), 20, 'fill="#cbd5e1" font-size="13"')}
`;
}

function arrow(x1, y1, x2, y2, label = '') {
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    return `
<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#94a3b8" stroke-width="3" marker-end="url(#arrow)"/>
${label ? `<text x="${mx}" y="${my - 8}" text-anchor="middle" fill="#fbbf24" font-size="11" font-weight="700">${escapeXml(label)}</text>` : ''}
`;
}

function renderProcess(spec) {
    const items = spec.steps.length ? spec.steps : spec.labels;
    let svg = '';
    const count = Math.max(1, Math.min(items.length, 5));
    const boxW = 430;
    const boxH = 82;
    const startY = 245;

    for (let i = 0; i < count; i++) {
        const y = startY + i * 100;
        svg += roundedBox(70, y, boxW, boxH, `Step ${i + 1}`, items[i], i % 2 ? '#a78bfa' : '#38bdf8');
        if (i < count - 1) svg += arrow(285, y + boxH, 285, y + 100, 'next');
    }

    if (spec.inputs.length || spec.outputs.length) {
        if (spec.inputs.length) svg += roundedBox(35, 180, 245, 48, 'Inputs', spec.inputs.join(' • '), '#22c55e');
        if (spec.outputs.length) svg += roundedBox(290, 180, 245, 48, 'Outputs', spec.outputs.join(' • '), '#f59e0b');
    }
    return svg;
}

function renderSequence(spec) {
    const items = spec.steps.length ? spec.steps : spec.labels;
    const count = Math.max(1, Math.min(items.length, 6));
    let svg = '';
    const gap = 12;
    const w = Math.floor((480 - gap * (count - 1)) / count);
    const y = 350;

    for (let i = 0; i < count; i++) {
        const x = 45 + i * (w + gap);
        svg += `<rect x="${x}" y="${y}" width="${w}" height="155" rx="16" fill="#0f172a" stroke="#38bdf8" stroke-width="2"/>`;
        svg += `<circle cx="${x + w / 2}" cy="${y + 30}" r="16" fill="#38bdf8"/>`;
        svg += `<text x="${x + w / 2}" y="${y + 36}" text-anchor="middle" fill="#020617" font-size="12" font-weight="800">${i + 1}</text>`;
        svg += svgTextLines(items[i], x + w / 2, y + 78, Math.max(8, Math.floor(w / 8)), 17, 'text-anchor="middle" fill="#f8fafc" font-size="12" font-weight="700"');
        if (i < count - 1) svg += arrow(x + w, y + 78, x + w + gap, y + 78);
    }
    return svg;
}

function renderAlgorithm(spec) {
    const example = spec.examples[0] || '[10, 20, 30, 40, 50]';
    const values = example.match(/-?\d+(?:\.\d+)?/g) || ['10', '20', '30', '40', '50'];
    const nums = values.slice(0, 8);
    const boxW = Math.floor(440 / nums.length);
    let svg = '';

    nums.forEach((value, i) => {
        const x = 65 + i * boxW;
        const isMid = i === Math.floor(nums.length / 2);
        svg += `<rect x="${x}" y="330" width="${boxW - 5}" height="70" rx="8" fill="${isMid ? '#312e81' : '#0f172a'}" stroke="${isMid ? '#a78bfa' : '#475569'}" stroke-width="2"/>`;
        svg += `<text x="${x + (boxW - 5) / 2}" y="373" text-anchor="middle" fill="#f8fafc" font-size="18" font-weight="800">${escapeXml(value)}</text>`;
        if (isMid) svg += `<text x="${x + (boxW - 5) / 2}" y="420" text-anchor="middle" fill="#c4b5fd" font-size="11" font-weight="700">MID</text>`;
    });

    const labels = spec.labels.length ? spec.labels.slice(0, 5) : ['Compare', 'Choose', 'Discard', 'Repeat'];
    labels.forEach((label, i) => {
        const y = 500 + i * 52;
        svg += `<circle cx="95" cy="${y}" r="8" fill="#38bdf8"/>`;
        svg += `<text x="120" y="${y + 5}" fill="#e2e8f0" font-size="14" font-weight="600">${escapeXml(label)}</text>`;
    });
    return svg;
}

function renderMatrix(spec) {
    let svg = '';
    const examples = spec.examples.slice(0, 3);
    const matrixStrings = examples.length ? examples : ['1 2 1', '0 0 0', '-1 -2 -1'];

    matrixStrings.forEach((row, r) => {
        const nums = row.match(/-?\d+(?:\.\d+)?/g) || row.split(/\s+/).filter(Boolean);
        nums.slice(0, 5).forEach((n, c) => {
            const x = 70 + c * 58;
            const y = 290 + r * 58;
            svg += `<rect x="${x}" y="${y}" width="52" height="52" rx="6" fill="#111827" stroke="#475569"/>`;
            svg += `<text x="${x + 26}" y="${y + 33}" text-anchor="middle" fill="#f8fafc" font-size="16" font-weight="700">${escapeXml(n)}</text>`;
        });
    });

    const labels = spec.labels.length ? spec.labels : ['Input pixels', 'Kernel', 'Convolution', 'Gradient', 'Edge'];
    labels.slice(0, 5).forEach((label, i) => {
        svg += roundedBox(300, 270 + i * 75, 220, 58, label, i < spec.steps.length ? spec.steps[i] : 'Topic-specific operation', i % 2 ? '#a78bfa' : '#38bdf8');
    });
    return svg;
}

function renderComparison(spec) {
    let svg = '';
    const labels = spec.labels.length ? spec.labels.slice(0, 4) : ['Before', 'Operation', 'After'];
    const cols = Math.min(3, labels.length);
    const w = 145;

    labels.slice(0, cols).forEach((label, i) => {
        const x = 40 + i * 165;
        svg += `<rect x="${x}" y="285" width="145" height="220" rx="18" fill="#0f172a" stroke="#38bdf8" stroke-width="2"/>`;
        svg += `<text x="${x + 72}" y="320" text-anchor="middle" fill="#f8fafc" font-size="14" font-weight="800">${escapeXml(label)}</text>`;
        const body = spec.steps[i] || spec.mainIdea || 'Topic-specific state';
        svg += svgTextLines(body, x + 72, 365, 14, 19, 'text-anchor="middle" fill="#cbd5e1" font-size="12"');
        if (i < cols - 1) svg += arrow(x + 145, 395, x + 165, 395);
    });
    return svg;
}

function renderTable(spec) {
    const headers = spec.tableHeaders.length ? spec.tableHeaders : ['Concept', 'Meaning'];
    const rows = spec.tableRows.length ? spec.tableRows : spec.labels.slice(0, 5).map(x => [x, spec.mainIdea]);
    const cols = Math.min(headers.length, 4);
    const cellW = 440 / cols;
    let svg = '';

    headers.slice(0, cols).forEach((h, c) => {
        const x = 65 + c * cellW;
        svg += `<rect x="${x}" y="270" width="${cellW}" height="55" fill="#1e293b" stroke="#475569"/>`;
        svg += `<text x="${x + cellW / 2}" y="304" text-anchor="middle" fill="#f8fafc" font-size="13" font-weight="800">${escapeXml(h)}</text>`;
    });

    rows.slice(0, 6).forEach((row, r) => {
        row.slice(0, cols).forEach((cell, c) => {
            const x = 65 + c * cellW;
            const y = 325 + r * 60;
            svg += `<rect x="${x}" y="${y}" width="${cellW}" height="60" fill="#0f172a" stroke="#334155"/>`;
            svg += svgTextLines(cell, x + cellW / 2, y + 24, Math.max(8, Math.floor(cellW / 9)), 16, 'text-anchor="middle" fill="#cbd5e1" font-size="11"');
        });
    });
    return svg;
}

function renderEquation(spec) {
    const formula = spec.formula || spec.mainIdea || spec.labels.join(' → ');
    let svg = `<rect x="55" y="290" width="460" height="120" rx="20" fill="#020617" stroke="#a78bfa" stroke-width="2"/>`;
    svg += `<text x="285" y="360" text-anchor="middle" fill="#f8fafc" font-size="22" font-weight="800">${escapeXml(formula)}</text>`;
    if (spec.steps.length) {
        spec.steps.slice(0, 4).forEach((step, i) => {
            svg += roundedBox(55 + (i % 2) * 235, 450 + Math.floor(i / 2) * 105, 220, 82, `Part ${i + 1}`, step, '#38bdf8');
        });
    }
    return svg;
}


function renderPhotosynthesis(spec, sceneIndex = 0) {
    const scene = sceneIndex % 6;
    let svg = '';

    // Sun
    svg += `<circle cx="105" cy="365" r="45" fill="#f59e0b" stroke="#fde68a" stroke-width="4"/>`;
    svg += `<text x="105" y="430" text-anchor="middle" fill="#fef3c7" font-size="12" font-weight="800">SUNLIGHT</text>`;
    svg += `<line x1="145" y1="365" x2="220" y2="365" stroke="#fbbf24" stroke-width="5" marker-end="url(#arrow)"/>`;

    // Plant stem and leaf
    svg += `<path d="M330 560 C325 500 330 430 345 380" fill="none" stroke="#22c55e" stroke-width="12" stroke-linecap="round"/>`;
    svg += `<path d="M338 450 C285 395 220 410 205 455 C260 475 310 470 338 450Z" fill="#166534" stroke="#4ade80" stroke-width="4"/>`;
    svg += `<path d="M338 450 C390 395 455 410 470 455 C415 475 365 470 338 450Z" fill="#15803d" stroke="#4ade80" stroke-width="4"/>`;
    svg += `<path d="M338 450 L245 438 M338 450 L430 438" stroke="#86efac" stroke-width="3"/>`;
    svg += `<text x="338" y="600" text-anchor="middle" fill="#86efac" font-size="15" font-weight="900">PLANT / LEAF</text>`;

    // Chloroplast
    svg += `<ellipse cx="338" cy="435" rx="38" ry="22" fill="#14532d" stroke="#86efac" stroke-width="3"/>`;
    svg += `<path d="M312 430 q10 -12 20 0 t20 0 t20 0" fill="none" stroke="#bbf7d0" stroke-width="3"/>`;
    svg += `<text x="338" y="400" text-anchor="middle" fill="#bbf7d0" font-size="11" font-weight="800">CHLOROPLAST</text>`;

    // CO2 and water
    svg += `<rect x="55" y="515" width="120" height="52" rx="14" fill="#172554" stroke="#60a5fa" stroke-width="2"/>`;
    svg += `<text x="115" y="548" text-anchor="middle" fill="#dbeafe" font-size="17" font-weight="900">CO₂</text>`;
    svg += `<text x="115" y="585" text-anchor="middle" fill="#93c5fd" font-size="10">CARBON DIOXIDE</text>`;
    svg += `<line x1="175" y1="540" x2="275" y2="470" stroke="#60a5fa" stroke-width="4" marker-end="url(#arrow)"/>`;

    svg += `<path d="M455 515 C480 540 480 565 455 575 C430 565 430 540 455 515Z" fill="#38bdf8" stroke="#bae6fd" stroke-width="3"/>`;
    svg += `<text x="455" y="605" text-anchor="middle" fill="#bae6fd" font-size="16" font-weight="900">H₂O</text>`;
    svg += `<line x1="435" y1="515" x2="395" y2="475" stroke="#38bdf8" stroke-width="4" marker-end="url(#arrow)"/>`;

    // Outputs
    svg += `<rect x="95" y="665" width="170" height="62" rx="16" fill="#3f2b08" stroke="#fbbf24" stroke-width="3"/>`;
    svg += `<text x="180" y="692" text-anchor="middle" fill="#fde68a" font-size="15" font-weight="900">GLUCOSE</text>`;
    svg += `<text x="180" y="713" text-anchor="middle" fill="#fef3c7" font-size="10">C₆H₁₂O₆ • FOOD</text>`;
    svg += `<line x1="300" y1="570" x2="230" y2="665" stroke="#fbbf24" stroke-width="4" marker-end="url(#arrow)"/>`;

    svg += `<rect x="305" y="665" width="170" height="62" rx="16" fill="#052e16" stroke="#4ade80" stroke-width="3"/>`;
    svg += `<text x="390" y="692" text-anchor="middle" fill="#bbf7d0" font-size="15" font-weight="900">OXYGEN</text>`;
    svg += `<text x="390" y="713" text-anchor="middle" fill="#dcfce7" font-size="10">O₂ • RELEASED</text>`;
    svg += `<line x1="375" y1="570" x2="390" y2="665" stroke="#4ade80" stroke-width="4" marker-end="url(#arrow)"/>`;

    // Change composition slightly by scene so the same picture isn't reused.
    if (scene === 1 || scene === 4) {
        svg += `<rect x="185" y="290" width="300" height="50" rx="15" fill="#111827" stroke="#22c55e"/>`;
        svg += `<text x="335" y="322" text-anchor="middle" fill="#bbf7d0" font-size="15" font-weight="900">LIGHT ENERGY → CHEMICAL ENERGY</text>`;
    } else if (scene === 2 || scene === 5) {
        svg += `<rect x="85" y="280" width="400" height="62" rx="15" fill="#111827" stroke="#38bdf8"/>`;
        svg += `<text x="285" y="307" text-anchor="middle" fill="#bae6fd" font-size="12" font-weight="800">PHOTOSYNTHESIS EQUATION</text>`;
        svg += `<text x="285" y="329" text-anchor="middle" fill="#f8fafc" font-size="14" font-weight="900">6CO₂ + 6H₂O + LIGHT → C₆H₁₂O₆ + 6O₂</text>`;
    } else {
        svg += `<text x="285" y="315" text-anchor="middle" fill="#86efac" font-size="18" font-weight="900">HOW PHOTOSYNTHESIS HAPPENS</text>`;
    }

    return svg;
}

function renderStructure(spec, topic = '') {
    const labels = spec.labels.length ? spec.labels.slice(0, 7) : spec.keywords.slice(0, 7);
    let svg = '';
    const centerX = 285;
    const centerY = 405;
    const radius = 150;

    svg += `<circle cx="${centerX}" cy="${centerY}" r="70" fill="#172554" stroke="#38bdf8" stroke-width="3"/>`;
    svg += svgTextLines(spec.heading || cleanText(topic) || 'Topic', centerX, centerY - 8, 13, 18, 'text-anchor="middle" fill="#f8fafc" font-size="13" font-weight="800"');

    labels.forEach((label, i) => {
        const angle = -Math.PI / 2 + (Math.PI * 2 * i) / labels.length;
        const x = centerX + Math.cos(angle) * radius;
        const y = centerY + Math.sin(angle) * radius;
        svg += `<line x1="${centerX}" y1="${centerY}" x2="${x}" y2="${y}" stroke="#475569" stroke-width="2" marker-end="url(#arrow)"/>`;
        svg += `<rect x="${x - 65}" y="${y - 27}" width="130" height="54" rx="14" fill="#0f172a" stroke="#334155"/>`;
        svg += svgTextLines(label, x, y - 4, 13, 16, 'text-anchor="middle" fill="#e2e8f0" font-size="11" font-weight="700"');
    });
    return svg;
}

function renderGenericSpecific(spec, topic, scene) {
    const labels = [...spec.labels, ...spec.keywords].filter(Boolean).slice(0, 6);
    let svg = '';
    const base = spec.steps.length ? spec.steps : labels;

    base.slice(0, 5).forEach((item, i) => {
        const x = 50 + (i % 2) * 245;
        const y = 275 + Math.floor(i / 2) * 125;
        svg += roundedBox(x, y, 220, 95, `${i + 1}. ${spec.heading || cleanText(topic)}`, item, i % 2 ? '#a78bfa' : '#38bdf8');
    });

    if (spec.relations.length) {
        spec.relations.slice(0, 4).forEach((r, i) => {
            svg += `<text x="285" y="680" text-anchor="middle" fill="#fbbf24" font-size="12" font-weight="700">${escapeXml(r.from)} → ${escapeXml(r.to)}${r.label ? ` • ${escapeXml(r.label)}` : ''}</text>`;
            if (i < 3) svg += `<line x1="120" y1="690" x2="450" y2="690" stroke="#334155"/>`;
        });
    }

    return svg;
}

function renderVisualSvg(spec, topic, scene, sceneIndex, totalScenes) {
    const accent = ['#38bdf8', '#a78bfa', '#22c55e', '#f59e0b', '#f472b6', '#2dd4bf'][sceneIndex % 6];
    const heading = cleanText(spec?.heading || topic).slice(0, 70);
    const subtitle = cleanText(spec?.subtitle || scene?.title || '').slice(0, 150);
    const mainIdea = cleanText(spec?.mainIdea || scene?.narration || '').slice(0, 240);

    let body = '';
    const exactTopicLower = cleanText(topic).toLowerCase();

    if (exactTopicLower.includes('photosynthesis')) {
        body = renderPhotosynthesis(spec, sceneIndex);
    } else {
        switch (spec.visualType) {
            case 'process':
            case 'flowchart':
            case 'cycle':
                body = renderProcess(spec);
                break;
            case 'sequence':
            case 'timeline':
                body = renderSequence(spec);
                break;
            case 'algorithm':
                body = renderAlgorithm(spec);
                break;
            case 'matrix':
                body = renderMatrix(spec);
                break;
            case 'comparison':
            case 'cause_effect':
                body = renderComparison(spec);
                break;
            case 'table':
                body = renderTable(spec);
                break;
            case 'equation':
                body = renderEquation(spec);
                break;
            case 'structure':
            case 'anatomy':
            case 'system':
            case 'concept_map':
                body = renderStructure(spec, topic);
                break;
            default:
                body = renderGenericSpecific(spec, topic, scene);
                break;
        }
    }

    const keywordLine = (spec.keywords || []).slice(0, 6).join(' • ');

    return `
<svg xmlns="http://www.w3.org/2000/svg" width="570" height="850" viewBox="0 0 570 850">
<defs>
  <marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
    <path d="M0,0 L0,6 L9,3 z" fill="#94a3b8"/>
  </marker>
</defs>
<rect width="570" height="850" fill="#020617"/>
<rect x="18" y="18" width="534" height="814" rx="28" fill="#0b1120" stroke="#1e293b" stroke-width="2"/>
<text x="42" y="55" fill="#64748b" font-size="11" font-weight="800">TEACHBACK • EXACT TOPIC VISUAL • SCENE ${sceneIndex + 1}/${totalScenes}</text>
<text x="42" y="92" fill="${accent}" font-size="23" font-weight="900">${escapeXml(heading)}</text>
${svgTextLines(subtitle, 42, 120, 58, 18, 'fill="#cbd5e1" font-size="12"')}
<rect x="40" y="155" width="490" height="90" rx="18" fill="#111827" stroke="#334155"/>
<text x="58" y="184" fill="${accent}" font-size="11" font-weight="800">SCENE IDEA</text>
${svgTextLines(mainIdea, 58, 208, 58, 17, 'fill="#e2e8f0" font-size="12"')}
<rect x="35" y="265" width="500" height="415" rx="22" fill="#020617" stroke="#1e293b"/>
${body}
${keywordLine ? `<text x="285" y="725" text-anchor="middle" fill="#64748b" font-size="10">${escapeXml(keywordLine)}</text>` : ''}
<line x1="55" y1="755" x2="515" y2="755" stroke="#1e293b" stroke-width="2"/>
<text x="285" y="785" text-anchor="middle" fill="#94a3b8" font-size="11" font-weight="700">${escapeXml(cleanText(topic))}</text>
<rect x="35" y="807" width="500" height="9" rx="4" fill="#1e293b"/>
<rect x="35" y="807" width="${Math.max(12, Math.round(500 * ((sceneIndex + 1) / totalScenes)))}" height="9" rx="4" fill="${accent}"/>
</svg>
`;
}

async function createSceneImage(scene, topic, index, total, outputPath) {
    /*
     * IMPORTANT:
     * This renderer intentionally does NOT create diagrams, flowcharts,
     * Venn diagrams, concept maps, matrices, arrows, icons, or topic
     * templates. It displays ONLY a few short, important points taken
     * directly from this scene's explanation.
     */

    const cleanTopic = cleanText(topic || 'Topic');
    const narration = cleanText(scene?.narration || '');
    const title = cleanText(scene?.title || 'Key Points');

    console.log('\n--------------------------------------------');
    console.log(`Creating SHORT-POINT visual: ${cleanTopic}`);
    console.log(`Scene: ${index + 1}/${total}`);
    console.log(`Title: ${title}`);
    console.log('Visual mode: IMPORTANT POINTS ONLY');
    console.log('No diagrams / flowcharts / Venn diagrams / generic visual structures.');
    console.log('--------------------------------------------');

    const forbiddenVisualTerms = [
        'venn diagram',
        'flow chart',
        'flowchart',
        'concept map',
        'mind map',
        'diagram',
        'matrix',
        'table',
        'timeline',
        'chart',
        'graph',
        'network',
        'cycle',
        'tree diagram',
        'decision tree',
        'infographic',
        'process diagram',
        'illustration',
        'icon',
        'symbol'
    ];

    const removeVisualInstructionWords = (text) => {
        let value = cleanText(text);
        forbiddenVisualTerms.forEach(term => {
            value = value.replace(new RegExp(`\\b${term.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\b`, 'gi'), '');
        });
        return cleanText(value);
    };

    const shortenPoint = (text) => {
        let value = removeVisualInstructionWords(text)
            .replace(/^(in this scene|here|basically|simply|in simple words|remember that)[:,\s]*/i, '')
            .replace(/^the main idea is[:,\s]*/i, '')
            .replace(/^the important point is[:,\s]*/i, '')
            .replace(/\s+/g, ' ')
            .trim();

        // Keep the actual explanation, but make it short enough for one card.
        if (value.length > 105) {
            const words = value.split(/\s+/).slice(0, 16);
            value = words.join(' ');
            if (!/[.!?]$/.test(value)) value += '…';
        }

        return value;
    };

    const isUsefulPoint = (text) => {
        const value = cleanText(text);
        if (!value || value.length < 18) return false;

        const lower = value.toLowerCase();
        if (forbiddenVisualTerms.some(term => lower.includes(term))) return false;

        // Ignore narration that is only a transition or presentation instruction.
        const ignored = [
            'in the next scene',
            'let us see',
            'let\'s see',
            'now we will',
            'now let us',
            'as you can see',
            'finally, let us',
            'in conclusion'
        ];
        if (ignored.some(prefix => lower.startsWith(prefix))) return false;

        return true;
    };

    /*
     * Extract only the strongest explanatory sentences. We deliberately
     * avoid scene.visualPlan because that field can contain instructions
     * such as diagrams/flowcharts. The narration is the source of truth.
     */
    let candidates = narration
        .split(/(?<=[.!?])\s+/)
        .map(shortenPoint)
        .filter(isUsefulPoint);

    // Remove duplicates and near-duplicates.
    const unique = [];
    for (const point of candidates) {
        const normalized = point
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();

        if (!normalized) continue;

        const duplicate = unique.some(existing => {
            const other = existing
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, ' ')
                .trim();

            return other === normalized ||
                other.includes(normalized) ||
                normalized.includes(other);
        });

        if (!duplicate) unique.push(point);
    }

    // Prefer up to three genuinely useful points, not a wall of text.
    let points = unique.slice(0, 3);

    // If the narration has only one long sentence, split it into useful clauses.
    if (points.length < 2 && narration.length > 100) {
        const clauses = narration
            .split(/[,;:]\s+/)
            .map(shortenPoint)
            .filter(isUsefulPoint);

        for (const clause of clauses) {
            if (points.length >= 3) break;
            if (!points.some(p => p.toLowerCase() === clause.toLowerCase())) {
                points.push(clause);
            }
        }
    }

    // Last-resort fallback: ONE exact-topic point only.
    if (!points.length) {
        points = [`${cleanTopic} — see the key idea explained in this lesson.`];
    }

    points = points.slice(0, 3);

    console.log('Important points selected:');
    points.forEach((point, i) => console.log(`  ${i + 1}. ${point}`));

    const accents = [
        '#38bdf8',
        '#a78bfa',
        '#22c55e',
        '#f59e0b',
        '#f472b6',
        '#2dd4bf'
    ];
    const accent = accents[index % accents.length];

    const wrapPoint = (text, maxChars = 43) => {
        const words = cleanText(text).split(/\s+/);
        const lines = [];
        let line = '';

        for (const word of words) {
            const next = line ? `${line} ${word}` : word;
            if (next.length > maxChars && line) {
                lines.push(line);
                line = word;
            } else {
                line = next;
            }
        }
        if (line) lines.push(line);
        return lines.slice(0, 3);
    };

    let cards = '';
    const cardStartY = 235;
    const cardGap = 18;
    const cardHeight = points.length === 1 ? 150 : 145;

    points.forEach((point, i) => {
        const y = cardStartY + i * (cardHeight + cardGap);
        const lines = wrapPoint(point);

        cards += `
<rect x="42" y="${y}" width="486" height="${cardHeight}" rx="20" fill="#0f172a" stroke="#263449" stroke-width="2"/>
<circle cx="78" cy="${y + 38}" r="20" fill="${accent}"/>
<text x="78" y="${y + 44}" text-anchor="middle" fill="#020617" font-size="16" font-weight="900">${i + 1}</text>
<text x="112" y="${y + 39}" fill="${accent}" font-size="11" font-weight="900">IMPORTANT POINT</text>
${lines.map((line, lineIndex) =>
            `<text x="72" y="${y + 75 + lineIndex * 25}" fill="#f8fafc" font-size="15" font-weight="700">${escapeXml(line)}</text>`
        ).join('')}
`;
    });

    const progressWidth = Math.max(
        12,
        Math.round(486 * ((index + 1) / Math.max(1, total)))
    );

    const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${VIDEO_WIDTH}" height="${VIDEO_HEIGHT}" viewBox="0 0 ${VIDEO_WIDTH} ${VIDEO_HEIGHT}">
<rect width="${VIDEO_WIDTH}" height="${VIDEO_HEIGHT}" fill="#020617"/>
<rect x="18" y="18" width="534" height="814" rx="28" fill="#0b1120" stroke="#1e293b" stroke-width="2"/>

<text x="42" y="55" fill="#64748b" font-size="11" font-weight="800">TEACHBACK • KEY POINTS • SCENE ${index + 1}/${total}</text>
<text x="42" y="95" fill="${accent}" font-size="23" font-weight="900">${escapeXml(cleanTopic)}</text>
<text x="42" y="128" fill="#cbd5e1" font-size="13" font-weight="700">${escapeXml(title)}</text>

<line x1="42" y1="155" x2="528" y2="155" stroke="#1e293b" stroke-width="2"/>
<text x="42" y="190" fill="#f8fafc" font-size="17" font-weight="900">ONLY THE IMPORTANT POINTS</text>

${cards}

<line x1="55" y1="755" x2="515" y2="755" stroke="#1e293b" stroke-width="2"/>
<text x="285" y="785" text-anchor="middle" fill="#64748b" font-size="10" font-weight="700">${escapeXml(cleanTopic)}</text>
<rect x="42" y="807" width="486" height="8" rx="4" fill="#1e293b"/>
<rect x="42" y="807" width="${progressWidth}" height="8" rx="4" fill="${accent}"/>
</svg>
`;

    try {
        await sharp(Buffer.from(svg, 'utf8'))
            .png()
            .resize(VIDEO_WIDTH, VIDEO_HEIGHT)
            .toFile(outputPath);
    } catch (error) {
        console.error('Important-point visual rendering failed:', error.message);
        throw new Error(`Could not render important-point visual: ${error.message}`);
    }

    if (!fs.existsSync(outputPath)) {
        throw new Error('Sharp did not create the important-point visual PNG.');
    }

    const stat = fs.statSync(outputPath);
    if (stat.size < 1000) {
        throw new Error('Generated important-point visual PNG is too small.');
    }

    console.log(`IMPORTANT-POINT visual created successfully: ${outputPath}`);
}


/* =========================================================
   TTS
========================================================= */

async function generateSpeech(
    text,
    outputPath
) {
    let EdgeTTS;

    try {
        const module =
            require(
                'node-edge-tts'
            );

        EdgeTTS =
            module.EdgeTTS;
    } catch {
        throw new Error(
            'node-edge-tts is not installed. Run: npm install node-edge-tts'
        );
    }

    if (
        typeof EdgeTTS !==
        'function'
    ) {
        throw new Error(
            'Could not load EdgeTTS from node-edge-tts.'
        );
    }

    const tts =
        new EdgeTTS({
            voice:
                TTS_VOICE,

            lang:
                TTS_LANGUAGE,

            outputFormat:
                'audio-24khz-48kbitrate-mono-mp3',
        });

    await tts.ttsPromise(
        text,
        outputPath
    );

    if (
        !fs.existsSync(
            outputPath
        )
    ) {
        throw new Error(
            'TTS did not create an audio file.'
        );
    }

    const stat =
        fs.statSync(
            outputPath
        );

    if (
        stat.size < 1000
    ) {
        throw new Error(
            'Generated audio file is too small.'
        );
    }
}


/* =========================================================
   GET MEDIA DURATION
========================================================= */

async function getDuration(
    filePath
) {
    try {
        const result =
            await execFileP(
                FFPROBE_PATH,
                [
                    '-v',
                    'error',
                    '-show_entries',
                    'format=duration',
                    '-of',
                    'default=noprint_wrappers=1:nokey=1',
                    filePath,
                ],
                {
                    windowsHide:
                        true,
                    maxBuffer:
                        5 *
                        1024 *
                        1024,
                }
            );

        const duration =
            parseFloat(
                String(
                    result.stdout
                ).trim()
            );

        if (
            Number.isFinite(
                duration
            )
        ) {
            return duration;
        }
    } catch (error) {
        console.log(
            'ffprobe duration error:',
            error.message
        );
    }

    return 0;
}


/* =========================================================
   CREATE SCENE VIDEO
========================================================= */

async function createSceneVideo(
    imagePath,
    audioPath,
    outputPath,
    duration
) {
    const safeDuration =
        Math.max(
            3,
            duration || 3
        );

    const zoomFilter =
        `
zoompan=
z='min(zoom+0.0007,1.12)':
x='iw/2-(iw/zoom/2)':
y='ih/2-(ih/zoom/2)':
d=1:
s=${VIDEO_WIDTH}x${VIDEO_HEIGHT}:
fps=${VIDEO_FPS}
`
            .replace(
                /\n/g,
                ''
            );

    await execFileP(
        FFMPEG_PATH,
        [
            '-y',

            '-loop',
            '1',

            '-i',
            imagePath,

            '-i',
            audioPath,

            '-vf',
            zoomFilter,

            '-t',
            String(
                safeDuration
            ),

            '-r',
            String(
                VIDEO_FPS
            ),

            '-c:v',
            'libx264',

            '-preset',
            'veryfast',

            '-crf',
            '24',

            '-pix_fmt',
            'yuv420p',

            '-c:a',
            'aac',

            '-b:a',
            '128k',

            '-shortest',

            outputPath,
        ],
        {
            windowsHide:
                true,

            maxBuffer:
                50 *
                1024 *
                1024,
        }
    );

    if (
        !fs.existsSync(
            outputPath
        )
    ) {
        throw new Error(
            'FFmpeg did not create the scene video.'
        );
    }
}


/* =========================================================
   CONCATENATE VIDEOS
========================================================= */

async function concatenateVideos(
    videoFiles,
    outputPath,
    workDir
) {
    const listPath =
        path.join(
            workDir,
            'concat.txt'
        );

    const content =
        videoFiles
            .map(
                (file) =>
                    `file '${file
                        .replace(
                            /\\/g,
                            '/'
                        )
                        .replace(
                            /'/g,
                            "'\\''"
                        )}'`
            )
            .join('\n');

    fs.writeFileSync(
        listPath,
        content,
        'utf8'
    );

    await execFileP(
        FFMPEG_PATH,
        [
            '-y',

            '-f',
            'concat',

            '-safe',
            '0',

            '-i',
            listPath,

            '-c',
            'copy',

            outputPath,
        ],
        {
            windowsHide:
                true,

            maxBuffer:
                50 *
                1024 *
                1024,
        }
    );

    if (
        !fs.existsSync(
            outputPath
        )
    ) {
        throw new Error(
            'FFmpeg failed to create the final video.'
        );
    }
}


/* =========================================================
   GENERATE VIDEO
========================================================= */

async function generateVideo(
    lesson,
    topic
) {
    const jobId =
        makeId('lesson');

    const workDir =
        path.join(
            TEMP_DIR,
            jobId
        );

    fs.mkdirSync(
        workDir,
        {
            recursive:
                true,
        }
    );

    const sceneVideos = [];
    const sceneMetadata = [];

    try {
        const totalScenes =
            lesson.scenes.length;

        console.log(
            '\n============================================'
        );

        console.log(
            'VIDEO GENERATION'
        );

        console.log(
            `Topic: ${topic}`
        );

        console.log(
            `Scenes: ${totalScenes}`
        );

        console.log(
            '============================================'
        );

        for (
            let i = 0;
            i < totalScenes;
            i++
        ) {
            const scene =
                lesson.scenes[i];

            console.log(
                `\nScene ${i + 1}/${totalScenes}: ${scene.title}`
            );

            console.log(
                `Visual plan: ${scene.visualPlan}`
            );

            const imagePath =
                path.join(
                    workDir,
                    `scene-${i + 1}.png`
                );

            const audioPath =
                path.join(
                    workDir,
                    `scene-${i + 1}.mp3`
                );

            const videoPath =
                path.join(
                    workDir,
                    `scene-${i + 1}.mp4`
                );

            console.log(
                'Creating fresh topic-specific visual...'
            );

            await createSceneImage(
                scene,
                topic,
                i,
                totalScenes,
                imagePath
            );

            console.log(
                'Generating Indian English narration...'
            );

            await generateSpeech(
                scene.narration,
                audioPath
            );

            let duration =
                await getDuration(
                    audioPath
                );

            if (
                !duration ||
                duration < 1
            ) {
                duration =
                    wordCount(
                        scene.narration
                    ) /
                    2.15;
            }

            duration =
                clamp(
                    duration,
                    5,
                    45
                );

            console.log(
                `Scene duration: ${duration.toFixed(
                    2
                )} seconds`
            );

            console.log(
                'Creating motion video...'
            );

            await createSceneVideo(
                imagePath,
                audioPath,
                videoPath,
                duration
            );

            sceneVideos.push(
                videoPath
            );

            sceneMetadata.push({
                index:
                    i + 1,

                title:
                    scene.title,

                narration:
                    scene.narration,

                visualPlan:
                    scene.visualPlan,

                duration:
                    duration,
            });
        }

        const finalName =
            `${safeFileName(
                topic
            ).slice(
                0,
                60
            )}-${Date.now()}.mp4`;

        const finalPath =
            path.join(
                GENERATED_DIR,
                finalName
            );

        console.log(
            '\nCombining scenes...'
        );

        await concatenateVideos(
            sceneVideos,
            finalPath,
            workDir
        );

        const finalDuration =
            await getDuration(
                finalPath
            );

        console.log(
            `Final video duration: ${finalDuration.toFixed(
                2
            )} seconds`
        );

        return {
            finalPath,

            finalName,

            duration:
                finalDuration,

            scenes:
                sceneMetadata,
        };
    } finally {
        try {
            fs.rmSync(
                workDir,
                {
                    recursive:
                        true,
                    force:
                        true,
                }
            );
        } catch { }
    }
}


/* =========================================================
   GENERATE VIDEO ROUTE
========================================================= */

app.post(
    '/generate-video',
    async (req, res) => {
        try {
            const {
                text,
                topic,
                explanation,
                example,
                recap,
            } = req.body;

            if (
                !text ||
                !String(text).trim()
            ) {
                return res
                    .status(400)
                    .json({
                        success:
                            false,
                        error:
                            'Study material is missing.',
                    });
            }

            if (
                !topic ||
                !String(topic).trim()
            ) {
                return res
                    .status(400)
                    .json({
                        success:
                            false,
                        error:
                            'Topic is required.',
                    });
            }

            const cleanTopic =
                String(
                    topic
                ).trim();

            console.log(
                '\n============================================'
            );

            console.log(
                'NEW VIDEO REQUEST'
            );

            console.log(
                `Topic: ${cleanTopic}`
            );

            console.log(
                'Language: English'
            );

            console.log(
                `Model: ${OLLAMA_MODEL}`
            );

            console.log(
                '============================================'
            );

            const lesson =
                await generateVideoScript(
                    text,
                    cleanTopic
                );

            const result =
                await generateVideo(
                    lesson,
                    cleanTopic
                );

            const videoUrl =
                `/generated/${encodeURIComponent(
                    result.finalName
                )}`;

            res.json({
                success:
                    true,

                title:
                    lesson.title,

                topic:
                    cleanTopic,

                language:
                    'english',

                voice:
                    TTS_VOICE,

                explanation:
                    explanation ||
                    '',

                example:
                    example ||
                    '',

                recap:
                    recap ||
                    '',

                narration:
                    lesson.scenes
                        .map(
                            (
                                scene
                            ) =>
                                scene.narration
                        )
                        .join(
                            '\n\n'
                        ),

                scenes:
                    result.scenes.map(
                        (
                            scene
                        ) => ({
                            title:
                                scene.title,

                            narration:
                                scene.narration,

                            visualPlan:
                                scene.visualPlan,

                            duration:
                                scene.duration,
                        })
                    ),

                wordCount:
                    wordCount(
                        lesson.scenes
                            .map(
                                (
                                    scene
                                ) =>
                                    scene.narration
                            )
                            .join(
                                ' '
                            )
                    ),

                sceneCount:
                    result.scenes
                        .length,

                duration:
                    result.duration,

                visualGeneration:
                    'fresh topic-specific visuals',

                motionGraphics:
                    true,

                videoUrl,
            });
        } catch (error) {
            console.error(
                '\n============================================'
            );

            console.error(
                'VIDEO GENERATION ERROR'
            );

            console.error(
                error
            );

            console.error(
                '============================================'
            );

            res
                .status(500)
                .json({
                    success:
                        false,

                    error:
                        error.message ||
                        'Video generation failed.',

                    details:
                        error.stack ||
                        '',
                });
        }
    }
);


/* =========================================================
   HEALTH CHECK
========================================================= */

app.get(
    '/health',
    async (req, res) => {
        let ollama =
            false;

        let ffmpeg =
            false;

        let ffprobe =
            false;

        let tesseract =
            false;

        let poppler =
            false;

        try {
            const response =
                await fetch(
                    'http://127.0.0.1:11434/api/tags'
                );

            ollama =
                response.ok;
        } catch { }

        ffmpeg =
            await commandExists(
                FFMPEG_PATH
            );

        ffprobe =
            await commandExists(
                FFPROBE_PATH
            );

        tesseract =
            fs.existsSync(
                TESSERACT_PATH
            );

        poppler =
            fs.existsSync(
                POPPLER_PATH
            );

        res.json({
            success:
                true,

            server:
                true,

            ollama,

            ollamaModel:
                OLLAMA_MODEL,

            ffmpeg,

            ffprobe,

            tesseract,

            poppler,

            ttsVoice:
                TTS_VOICE,
        });
    }
);


/* =========================================================
   ERROR HANDLER
========================================================= */

app.use(
    (
        err,
        req,
        res,
        next
    ) => {
        console.error(
            'UNHANDLED SERVER ERROR:',
            err
        );

        if (
            err instanceof
            multer.MulterError
        ) {
            return res
                .status(400)
                .json({
                    success:
                        false,

                    error:
                        err.code ===
                            'LIMIT_FILE_SIZE'
                            ? 'PDF must be 20 MB or smaller.'
                            : err.message,
                });
        }

        res
            .status(500)
            .json({
                success:
                    false,

                error:
                    err.message ||
                    'Internal server error.',
            });
    }
);


/* =========================================================
   START SERVER
========================================================= */

app.listen(
    PORT,
    () => {
        console.log(
            '============================================'
        );

        console.log(
            'TeachBack Backend Started'
        );

        console.log(
            '============================================'
        );

        console.log(
            `Server: http://localhost:${PORT}`
        );

        console.log(
            `Generated: http://localhost:${PORT}/generated`
        );

        console.log(
            `Ollama: ${OLLAMA_URL}`
        );

        console.log(
            `Model: ${OLLAMA_MODEL}`
        );

        console.log(
            `Voice: ${TTS_VOICE}`
        );

        console.log(
            `FFmpeg: ${FFMPEG_PATH}`
        );

        console.log(
            '============================================'
        );
    }
);