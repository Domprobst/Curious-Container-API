const CC = require('./cc-api.js');

const host = "127.0.0.1";
const user = "testuser";
const password = "testpassword";

// Define Connectors
let input_file1 = new CC.CCSSHConnector(host, "~/input/workload.R");
input_file1.setAuth("password", user, password);
let input_file2 = new CC.CCSSHConnector(host, "~/input/sleep.RData");
input_file2.setAuth("password", user, password);

let output_dir1 = new CC.CCSSHConnector(host, "~/output", 22, true);
output_dir1.setAuth("password", user, password);
let http_stdout = new CC.CCHTTPConnector("https://enu6mezvvfttd.x.pipedream.net/");
let http_stderr = new CC.CCHTTPConnector("https://enu6mezvvfttd.x.pipedream.net/");

// Define Input
let input_script = new CC.CCInput("script", "File", 0, input_file1);
let input_data = new CC.CCInput("data", "File", 1, input_file2);
// Define Output
let output_directory = new CC.CCOutput("output_directory", "Directory", "outputs/", output_dir1)
let output_stdout = new CC.CCOutput("mystdout", "stdout", null, http_stdout);
let output_stderr = new CC.CCOutput("mystderr", "stderr", null, http_stderr);

// Define Experiment
let experiment = new CC.CCExperiment("http://127.0.0.1:8080/", "agency_user", "agency_password", "Rscript", "dprobst/curious_containers:r_base", 256);
experiment.addInput(input_script);
experiment.addInput(input_data);
experiment.addOutput(output_directory);
experiment.addOutput(output_stdout);
experiment.addOutput(output_stderr);

// Add 5 GPUs with at least 256mb of vram
//experiment.addGPU(256, 5);

experiment.createRED();

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