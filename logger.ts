import { ansiColorFormatter, configure, getConsoleSink, getFileSink, getLogger, getRotatingFileSink } from "@logtape/logtape";

export const setUpLogger = async () => {
    await configure({
        sinks: { 
            console: getConsoleSink({formatter: ansiColorFormatter}),
            file: getRotatingFileSink("app.log", {
                maxSize: 0x400 * 0x400 * 5,
                maxFiles: 5
            }),
        },
        loggers: [
            { category: "ploofa", lowestLevel: "debug", sinks: ["console", "file"] },
        ],
    });
}


export const log = getLogger(["ploofa"]);