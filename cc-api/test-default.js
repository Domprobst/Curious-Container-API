const CC = require('./cc-api.js');

const host = "127.0.0.1";

const agency_url = "http://127.0.0.1:8090/";
const agency_user = "agency_user";
const agency_password = "agency_password";
const baseComand = "python3";
const container_image = "dprobst/curious_containers:python";
const ram = 256;
const timeout = 60 * 48;

CC.SSHServer.setPortRange(10410, 10439);

let experiment = new CC.DefaultExperiment(agency_url, agency_user, agency_password, baseComand, container_image, ram, timeout);
experiment.createDefaultIO(
    "~/shared",                   // location of shared directory
    "input/workload.py",           // location of script file relative to shared directory
    "input/sleep.RData",          // location of dataset file relative to shared directory
    ".",                          // location of output directory relative to shared directory
    host,                           // host ip / domain
).then(() => {
    experiment.startExperiment().then(experimentId => {
        let checkExperiment = setInterval(async function () {
            try {
                const status = await experiment.fetchCurrentStatus();
                console.log(status);
                if (status == "succeeded" || status == "failed" || status == "cancelled") {
                    clearInterval(checkExperiment);

                    const stdout = await experiment.getStdout();
                    const stderr = await experiment.getStderr();
                    console.log("stdout:\n" + stdout);
                    console.log("stderr:\n" + stderr);
                    console.log("debugInfo: " + experiment.debugInfo);
                }
            } catch (err) { }
        }, 10000);
    }).catch(error => {
        console.error(error);
    });
});
