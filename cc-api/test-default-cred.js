const CC = require('./cc-api.js');

const host = "127.0.0.1";
const user = "testuser";
const cred = process.env.PRIVATE_KEY;
//const mode = 'password';
const mode = 'privatekey'


const agency_url = "http://127.0.0.1:8090/";
const agency_user = "agency_user";
const agency_password = "agency_password";
const baseCommand = "python3";
const container_image = "dprobst/curious_containers:python";
const ram = 256;
const timeout = 60 * 48;

// Define Connectors
let input_file1 = new CC.CCSSHConnector(host, "~/input/workload.py");
input_file1.setAuth(mode, user, cred);
let input_file2 = new CC.CCSSHConnector(host, "~/input/sleep.RData");
input_file2.setAuth(mode, user, cred);

let output_dir1 = new CC.CCSSHConnector(host, "~/output", 22, true);
output_dir1.setAuth(mode, user, cred);

// Define Input
let input_script = new CC.CCInput("script", "File", 0, input_file1);
let input_data = new CC.CCInput("data", "File", 1, input_file2);
// Define Output
let output_directory = new CC.CCOutput("output_directory", "Directory", "outputs/", output_dir1)

let experiment = new CC.CCExperiment(agency_url, agency_user, agency_password, baseCommand, container_image, ram, timeout);
experiment.addInput(input_script);
experiment.addInput(input_data);
experiment.addOutput(output_directory);

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

