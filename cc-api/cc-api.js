/**
 * Represents a RED File for Curious Containers.
 * @class
 */
class CCExperiment {

    /**
     * Creates a new instance of CCExperiment.
     * @constructor
     * @param {string} ccAgencyUrl - The URL of the cc-agency.
     * @param {string} ccAgencyUsername - The username for accessing the cc-agency.
     * @param {string} ccAgencyPassword - The password for accessing the cc-agency.
     * @param {string} baseComand - The base command for the experiment.
     * @param {string} image - The Docker image URL for the experiment container.
     * @param {number} ram - The RAM size in MB required for the experiment.
     * @param {number} [timeout=0] - The timeout duration in minutes (default is 0, meaning no timeout).
     */
    constructor(ccAgencyUrl, ccAgencyUsername, ccAgencyPassword, baseComand, image, ram, timeout = 0) {
        this.ccAgencyUrl = ccAgencyUrl;
        this.ccAgencyUsername = ccAgencyUsername;
        this.ccAgencyPassword = ccAgencyPassword;
        this.baseComand = baseComand;
        this.image = image;
        this.ram = ram;
        this.timeout = timeout;

        this.inputs = [];
        this.outputs = [];
        this.gpus = [];
        this.currentStatus = "unknown";
        this.experimentId = undefined;
        this.batchId = undefined;
        this.debugInfo = undefined;
    }

    /**
     * Creates a new instance of CCExperiment. Should only be used for retrieving existing Experiments.
     * @param {string} ccAgencyUrl - The URL of the cc-agency.
     * @param {string} ccAgencyUsername - The username for accessing the cc-agency.
     * @param {string} ccAgencyPassword - The password for accessing the cc-agency.
     * @param {string} experimentId - The ID of the Experiment.
     * @returns {CCExperiment} A new instance of CCExperiment representing the retrieved experiment.
     */
    static getExistingExperiment(ccAgencyUrl, ccAgencyUsername, ccAgencyPassword, experimentId) {
        let ccExp = new CCExperiment(ccAgencyUrl, ccAgencyUsername, ccAgencyPassword);
        ccExp.experimentId = experimentId;
        return ccExp;
    }

    /**
     * Adds an input Connector to the experiment.
     * @param {CCInput} input - The input Connector to be added.
     */
    addInput(input) {
        this.inputs.push(input);
    }

    /**
     * Adds an output to the experiment.
     * @param {CCOutput} output - The output Connector object to be added.
     */
    addOutput(output) {
        this.outputs.push(output);
    }

    /**
     * Adds a GPU with the specified VRAM to the experiment.
     * @param {number} vramMin - The minimum VRAM in MB required for the GPU.
     * @param {number} [amount=1] - The number of GPUs to add (default is 1).
     */
    addGPU(vramMin, amount = 1) {
        for (let i = 0; i < amount; i++) {
            this.gpus.push({ 'vramMin': vramMin });
        }
    }

    /**
     * Set the SSH server to be used by the experiment's connector.
     *
     * @param {SSHServer} sshServer - The SSH server instance to set.
     */
    setSSHServer(sshServer) {
        this.sshServer = sshServer;
    }

    /**
     * Creates the RED Json for the experiment.
     */
    createRED() {
        this.red = {
            "redVersion": "9",
            "cli": this.getREDCli(),
            "inputs": this.getREDInputs(),
            "outputs": this.getREDOutputs(),
            "container": this.getREDContainer(),
            "execution": this.getREDExecution()
        }
    }

    /**
     * Starts the experiment by sending the RED object to the cc-agency.
     * @returns {Promise<string>} A promise that resolves with the experimentId on successful start.
     */
    async startExperiment() {
        if (!this.red) {
            this.createRED();
        }
        if (this.sshServer) {
            await this.sshServer.startServer();
        }

        const url = new URL(this.ccAgencyUrl);
        const post_data = JSON.stringify(this.red);
        const options = this.getWebRequestOptions(url, "red", "POST", post_data);
        const req_prot = this.getRequireProtocol(url.protocol);

        return new Promise((resolve, reject) => {
            const req = req_prot.request(options, resp => {
                let buffer = ""
                resp.on("data", chunk => {
                    buffer += chunk
                })
                resp.on("end", () => {
                    try {
                        let json_response = JSON.parse(buffer);
                        if (json_response.experimentId) {
                            this.experimentId = json_response.experimentId;
                            this.startTimeoutTimer();
                            resolve(this.experimentId);
                        } else {
                            reject(new Error("Experiment ID not returned in the response."));
                        }
                    } catch (err) {
                        reject(new Error("Failed to parse the response data: " + err.message));
                    }
                })
            }).on("error", err => {
                if (this.sshServer) {
                    this.sshServer.stopServer();
                }
                reject(new Error("HTTP request error: " + err.message))
            });
            req.write(post_data);
            req.end();
        });
    }

    /**
     * Cancels the currently running experiment by sending a DELETE request.
     * If the batchId is not known yet, it attempts to retrieve the batchId first.
     * @returns {Promise<boolean>} A promise that resolves with a boolean indicating if the cancellation was successful.
     *                             Rejects with an error if there is an issue with the HTTP request or response.
     */
    async cancelExperiment() {
        if (!this.batchId) {
            try {
                this.batchId = await this.getBatchId();
            } catch (err) {
                return false;
            }
        }

        this.clearTimeoutTimer();

        const url = new URL(this.ccAgencyUrl);
        const options = this.getWebRequestOptions(url, "batches/" + this.batchId, "DELETE");
        const req_prot = this.getRequireProtocol(url.protocol);

        return new Promise((resolve, reject) => {
            req_prot.request(options, resp => {
                let buffer = "";
                resp.on("data", chunk => {
                    buffer += chunk;
                });
                resp.on("end", () => {
                    try {
                        let json_response = JSON.parse(buffer);
                        resolve(json_response.state == "cancelled");
                        if (this.sshServer) {
                            this.sshServer.stopServer();
                        }
                    } catch (err) {
                        reject(new Error("Failed to parse the response data: " + err.message));
                    }
                });
            }).on("error", err => {
                reject(new Error("HTTP request error: " + err.message));
            }).end();
        });
    }

    /**
     * Fetches the current status of the experiment from the cc-agency.
     * @returns {Promise<string>} A promise that resolves with the current status of the experiment.
     */
    async fetchCurrentStatus() {
        if (!this.batchId) {
            try {
                this.batchId = await this.getBatchId();
            } catch (err) {
                return this.currentStatus;
            }
        }

        const url = new URL(this.ccAgencyUrl);
        const options = this.getWebRequestOptions(url, "batches/" + this.batchId, "GET");
        const req_prot = this.getRequireProtocol(url.protocol);

        return new Promise((resolve, reject) => {
            req_prot.request(options, resp => {
                let buffer = "";
                resp.on("data", chunk => {
                    buffer += chunk;
                });
                resp.on("end", () => {
                    try {
                        let json_response = JSON.parse(buffer);
                        this.currentStatus = json_response.state;
                        if (this.currentStatus == "failed") {
                            for (const historyElement of json_response.history) {
                                if (historyElement.state == "failed") {
                                    this.debugInfo = historyElement.debugInfo;
                                    break;
                                }
                            }
                        }
                        if (this.currentStatus == "succeeded" || this.currentStatus == "failed") {
                            this.clearTimeoutTimer();
                            if (this.sshServer) {
                                this.sshServer.stopServer();
                            }
                        }
                        resolve(this.currentStatus);
                    } catch (err) {
                        reject(new Error("Failed to parse the response data: " + err.message));
                    }
                });
            }).on("error", err => {
                reject(new Error("HTTP request error: " + err.message));
            }).end();
        });
    }

    /**
     * Retrieves the batch ID for the experiment from the cc-agency.
     * @returns {Promise<string>} A promise that resolves with the batch ID of the experiment.
     */
    getBatchId() {
        const url = new URL(this.ccAgencyUrl);
        const options = this.getWebRequestOptions(url, "batches?experimentId=" + this.experimentId, "GET");
        const req_prot = this.getRequireProtocol(url.protocol);

        return new Promise((resolve, reject) => {
            req_prot.request(options, resp => {
                let buffer = "";
                resp.on("data", chunk => {
                    buffer += chunk;
                });
                resp.on("end", () => {
                    try {
                        let json_response = JSON.parse(buffer);
                        for (const batch of json_response) {
                            if (batch.experimentId == this.experimentId) {
                                resolve(batch._id);
                                return;
                            }
                        }
                        reject(new Error("Experiment ID not found."));
                    } catch (err) {
                        reject(new Error("Failed to parse the response data: " + err.message));
                    }
                });
            }).on("error", err => {
                reject(new Error("HTTP request error: " + err.message));
            }).end();
        });
    }

    /**
     * Retrieves the web request options for making HTTP/HTTPS requests.
     * @param {URL} url - The URL object for the request.
     * @param {string} path - The API path for the request.
     * @param {string} method - The HTTP method for the request.
     * @param {string} [data] - Optional data to be sent in the request body.
     * @returns {object} The web request options object.
     */
    getWebRequestOptions(url, path, method, data) {
        let auth = 'Basic ' + Buffer.from(this.ccAgencyUsername + ':' + this.ccAgencyPassword).toString('base64');
        let options = {
            "hostname": url.hostname,
            "port": url.port || "8080",
            "path": url.pathname + path,
            "method": method,
            "headers": {
                "Content-Type": "application/json",
                "Authorization": auth,
            },
        }
        if (data) {
            options["headers"]["Content-Length"] = Buffer.byteLength(data);
        }
        return options;
    }

    /**
     * Returns the require protocol (http or https) based on the URL's protocol.
     * @param {string} protocol - The URL protocol (http or https).
     * @returns {object} The 'http' or 'https' module based on the URL protocol.
     */
    getRequireProtocol(protocol) {
        return protocol === "https:" ? require("https") : require("http");
    }

    /**
     * Returns the RED CLI Json for the experiment.
     * @returns {object} The RED CLI Json for the experiment.
     */
    getREDCli() {
        let cli = {
            "cwlVersion": "v1.0",
            "class": "CommandLineTool",
            "baseCommand": this.baseComand,
            "inputs": {},
            "outputs": {},
            "stdout": "stdout.txt",
            "stderr": "stderr.txt",
        }
        for (let i in this.inputs) {
            cli["inputs"][this.inputs[i].name] = this.inputs[i].getREDCliInput();
        }
        for (let i in this.outputs) {
            cli["outputs"][this.outputs[i].name] = this.outputs[i].getREDCliOutput();
        }
        return cli;
    }

    /**
     * Returns the RED inputs Json for the experiment.
     * @returns {object} The RED inputs Json for the experiment.
     * @throws {Error} If no inputs are defined for the experiment.
     */
    getREDInputs() {
        if (this.inputs.length === 0) {
            throw new Error('No inputs defined! Add at least one input.');
        }

        let redInputs = {};
        this.inputs.forEach(input => {
            redInputs[input.name] = input.getREDInput();
        });
        return redInputs;
    }

    /**
     * Returns the RED outputs Json for the experiment.
     * @returns {object} The RED outputs Json for the experiment.
     */
    getREDOutputs() {
        let redOutputs = {};
        this.outputs.forEach(output => {
            redOutputs[output.name] = output.getREDOutput();
        });
        return redOutputs;

    }

    /**
     * Returns the RED Json object for the experiment.
     * @returns {object} The RED Json object for the experiment.
     */
    getREDContainer() {
        let container = {
            "engine": "docker",
            "settings": {
                "image": {
                    "url": this.image,
                },
                "ram": this.ram
            }
        }
        if (this.gpus.length > 0) {
            container["settings"]["gpus"] = {
                "vendor": "nvidia",
                "devices": this.gpus
            }
        }
        return container;
    }

    /**
     * Returns the RED execution Json for the experiment.
     * @returns {object} The RED execution Json for the experiment.
     */
    getREDExecution() {
        return {
            "engine": "ccagency",
            "settings": {
                "access": {
                    "url": this.ccAgencyUrl,
                    "auth": {
                        "username": this.ccAgencyUsername,
                        "password": this.ccAgencyPassword,
                    }
                }
            }
        }
    }

    /**
     * Fetches the standard output (stdout) or standard error (stderr) of the experiment from the cc-agency.
     * @param {string} stream - The stream to fetch (either "stdout" or "stderr").
     * @returns {Promise<string>} A promise that resolves with the content of the specified stream.
     */
    getStd(stream) {
        const url = new URL(this.ccAgencyUrl);
        const options = this.getWebRequestOptions(url, "batches/" + this.batchId + "/" + stream, "GET");
        const req_prot = this.getRequireProtocol(url.protocol);

        return new Promise((resolve, reject) => {
            req_prot.request(options, resp => {
                let buffer = "";
                resp.on("data", chunk => {
                    buffer += chunk;
                });
                resp.on("end", () => {
                    if (resp.statusCode >= 400) {
                        buffer = "";
                    }
                    resolve(buffer);
                });
            }).on("error", err => {
                reject(new Error("HTTP request error: " + err.message));
            }).end();
        });
    }

    /**
     * Fetches the standard output (stdout) of the experiment from the cc-agency.
     * @returns {Promise<string>} A promise that resolves with the content of the stdout.
     */
    getStdout() {
        return this.getStd("stdout");
    }

    /**
     * Fetches the standard error (stderr) of the experiment from the cc-agency.
     * @returns {Promise<string>} A promise that resolves with the content of the stderr.
     */
    getStderr() {
        return this.getStd("stderr");
    }

    /**
     * Starts the timeout timer for the experiment cancellation.
     */
    startTimeoutTimer() {
        if (this.timeout > 0) {
            this.timeoutFunction = setTimeout(() => {
                this.cancelExperiment();
            }, this.timeout * 1000 * 60)
        }
    }

    /**
     * Clears the timeout timer for the experiment cancellation.
     */
    clearTimeoutTimer() {
        if (this.timeoutFunction) {
            clearTimeout(this.timeoutFunction);
        }
    }

}

/**
 * Represents a Default Experiment that extends CCExperiment.
 * This allows the use of already predefined inputs and outputs.
 * @class
 */
class DefaultExperiment extends CCExperiment {

    /**
     * Creates a new instance of DefaultExperiment.
     * @constructor
     * @param {string} ccAgencyUrl - The URL of the cc-agency.
     * @param {string} ccAgencyUsername - The username for accessing the cc-agency.
     * @param {string} ccAgencyPassword - The password for accessing the cc-agency.
     * @param {string} baseComand - The base command for the experiment.
     * @param {string} image - The Docker image URL for the experiment container.
     * @param {number} ram - The RAM size in MB required for the experiment.
     * @param {number} [timeout=0] - The timeout duration in minutes (default is 0, meaning no timeout).
     */
    constructor(ccAgencyUrl, ccAgencyUsername, ccAgencyPassword, baseComand, image, ram, timeout = 0) {
        super(ccAgencyUrl, ccAgencyUsername, ccAgencyPassword, baseComand, image, ram, timeout)
    }

    /**
     * Creates default input and output objects for the experiment. Contains an input Connector
     * for the script and the dataset. Also an output Connector for the output directory.
     * @param {string} sharedDirectory - The path to the shared directory on the host machine.
     * @param {string} scriptFile - Name of the script file inside the shared directory.
     * @param {string} dataset - Name of the dataset file inside the shared directory.
     * @param {string} output - Name of the output directory inside the shared directory.
     * @param {string} host - The host IP or domain for SSH connections.
     */
    async createDefaultIO(sharedDirectory, scriptFile, dataset, output, host) {
        let sshServer = new SSHServer(sharedDirectory);
        let sshPort = await sshServer.reservePort();
        super.setSSHServer(sshServer);

        let scriptFilePath = sshServer.dockerSharedDirectory + '/' + scriptFile;
        let datasetPath = sshServer.dockerSharedDirectory + '/' + dataset;
        let outputPath = sshServer.dockerSharedDirectory + '/' + output;

        let inputConnectorScript = new CCSSHConnector(host, scriptFilePath, sshPort);
        let inputConnectorData = new CCSSHConnector(host, datasetPath, sshPort);
        let outputConnectorDirectory = new CCSSHConnector(host, outputPath, sshPort, true);
        inputConnectorScript.setAuth("password", sshServer.username, sshServer.password);
        inputConnectorData.setAuth("password", sshServer.username, sshServer.password);
        outputConnectorDirectory.setAuth("password", sshServer.username, sshServer.password);

        let inputScript = new CCInput("script", "File", 0, inputConnectorScript);
        let inputData = new CCInput("data", "File", 1, inputConnectorData);
        let outputDirectory = new CCOutput("output_directory", "Directory", "outputs/", outputConnectorDirectory)

        super.addInput(inputScript);
        super.addInput(inputData);
        super.addOutput(outputDirectory);
    }

}

/**
 * Represents an input parameter for the experiment.
 * @class
 */
class CCInput {

    /**
     * Creates a new instance of CCInput.
     * @constructor
     * @param {string} name - The name of the input parameter.
     * @param {string} type - The type of the input parameter.
     * @param {number} position - The position of the input parameter in the command line.
     * @param {CCConnector} connector - The connector object for the input parameter.
     */
    constructor(name, type, position, connector) {
        this.name = name;
        this.type = type;
        this.position = position;
        this.connector = connector;
    }

    /**
     * Sets the string value for the input parameter.
     * @param {string} value - The string value to set for the input parameter.
     */
    setStringValue(value) {
        this.value = value;
    }

    /**
     * Sets the connector for the input parameter.
     * @param {CCConnector} connector - The connector object to set for the input parameter.
     */
    setConnector(connector) {
        this.connector = connector;
    }

    /**
     * Returns the RED CLI Json for the input parameter.
     * @returns {object} The RED CLI object for the input parameter.
     */
    getREDCliInput() {
        return {
            "type": this.type,
            "inputBinding": {
                "position": this.position
            }
        }
    }

    /**
     * Returns the RED Json for the input parameter.
     * @returns {string|object} The RED Json for the input parameter.
     */
    getREDInput() {
        if (this.type == "string") {
            return this.value;
        } else {
            return {
                "class": this.type,
                "connector": this.connector.getRED()
            }
        }
    }

}

/**
 * Represents an output parameter for the experiment.
 * @class
 */
class CCOutput {

    /**
     * Creates a new instance of CCOutput.
     * @constructor
     * @param {string} name - The name of the output parameter.
     * @param {string} type - The type of the output parameter.
     * @param {string} glob - The glob pattern for the output files.
     * @param {CCConnector} connector - The connector object for the output parameter.
     */
    constructor(name, type, glob, connector) {
        this.name = name;
        this.type = type;
        this.glob = glob;
        this.connector = connector;
    }

    /**
     * Sets the connector for the output parameter.
     * @param {CCConnector} connector - The connector object to set for the output parameter.
     */
    setConnector(connector) {
        this.connector = connector;
    }

    /**
     * Returns the RED CLI Json for the output parameter.
     * @returns {object} The RED CLI Json for the output parameter.
     */
    getREDCliOutput() {
        let cli = {
            "type": this.type,
        }
        if (this.glob) {
            cli["outputBinding"] = {
                "glob": this.glob
            }
        }
        return cli;
    }

    /**
     * Returns the RED Json for the output parameter.
     * @returns {object} The RED Json for the output parameter.
     */
    getREDOutput() {
        return {
            "class": this.type,
            "connector": this.connector.getRED()
        }
    }

}

/**
 * Represents a Connector for Curious Containers.
 * @class
 */
class CCConnector {

    /**
     * Creates a new instance of CCConnector.
     * @constructor
     */
    constructor() { }

    /**
     * Sets the authentication information for the connector.
     * @param {string} type - The type of authentication ("password" or "privatekey").
     * @param {string} username - The username for authentication.
     * @param {string} credential - The credential (password or private key) for authentication.
     * @param {string} [passphrase] - The passphrase for the private key (optional, only for "privatekey" authentication).
     */
    setAuth(type, username, credential, passphrase) {
        this.auth = { "username": username };
        if (type.toLowerCase() == "password") {
            this.auth["password"] = credential;
        } else if (type.toLowerCase() == "privatekey") {
            this.auth["privateKey"] = credential;
            if (passphrase) {
                this.auth["passphrase"] = passphrase;
            }
        }
    }
}

/**
 * Represents an SSH Connector for Curious Containers, extending CCConnector.
 * @class
 */
class CCSSHConnector extends CCConnector {

    /**
     * Creates a new instance of CCSSHConnector.
     * @constructor
     * @param {string} host - The host IP or domain for SSH connection.
     * @param {string} path - The path to the file or directory on the host machine.
     * @param {number} [port=22] - The SSH port (default is 22).
     * @param {boolean} [isDirectory=false] - Whether the path represents a directory (default is false).
     * @param {boolean} [isMountable=false] - Whether the path should be mounted inside the container (default is false).
     */
    constructor(host, path, port = 22, isDirectory = false, isMountable = false) {
        super();
        this.host = host;
        this.port = port;
        this.path = path;
        this.isDirectory = isDirectory;
        this.isMountable = isMountable;
    }

    /**
     * Returns the RED Json for the SSH connector.
     * @returns {object} The RED Json for the SSH connector.
     * @throws {Error} If no authentication method is set for the connector. Use setAuth().
     */
    getRED() {
        if (!this.auth) {
            throw new Error('No authentification method set! Use setAuth().');
        }

        let red = {
            "command": "red-connector-ssh",
            "access": {
                "host": this.host,
                "port": this.port,
                "auth": this.auth,
            }
        };
        if (this.isDirectory) {
            red["access"]["dirPath"] = this.path;
        } else {
            red["access"]["filePath"] = this.path;
        }
        if (this.isMountable) {
            red["mount"] = true;
        }
        return red;
    }

}

/**
 * Represents an HTTP Connector for Curious Containers, extending CCConnector.
 * @class
 */
class CCHTTPConnector extends CCConnector {

    /**
     * Creates a new instance of CCHTTPConnector.
     * @constructor
     * @param {string} url - The URL for the HTTP request.
     * @param {string} [method="GET"] - The HTTP method for the request (default is "GET").
     * @param {boolean} [disableSSLVerification=false] - Whether to disable SSL verification (default is false).
     */
    constructor(url, method = "GET", disableSSLVerification = false) {
        super();
        this.url = url;
        this.method = method;
        this.disableSSLVerification = disableSSLVerification;
    }

    /**
     * Returns the RED Json for the HTTP connector.
     * @returns {object} The RED Json for the HTTP connector.
     */
    getRED() {
        let red = {
            "command": "red-connector-http",
            "access": {
                "url": this.url,
                "method": this.method,
                "disableSSLVerification": this.disableSSLVerification,
            }
        }
        if (this.auth) {
            red["access"]["auth"] = this.auth;
        }
        return red;
    }

}

/**
 * Represents an FTP Connector for Curious Containers, extending CCConnector.
 * @class
 */
class CCFTPConnector extends CCConnector {

    /**
     * Creates a new instance of CCFTPConnector.
     * @constructor
     * @param {string} url - The URL for the FTP request.
     */
    constructor(url) {
        super();
        this.url = url;
    }

    /**
     * Returns the RED Json for the FTP connector.
     * @returns {object} The RED Json for the FTP connector.
     */
    getRED() {
        let red = {
            "command": "red-connector-ftp",
            "access": {
                "url": this.url,
            }
        }
        return red;
    }

}

/**
 * SSHServer class for managing Docker containers running SSH servers.
 */
class SSHServer {

    /**
     * An array to keep track of available ports for SSH server containers.
     */
    static availablePorts = [];

    /**
     * Constructor for the SSHServer class.
     *
     * @param {string} sharedDirectory - The directory to be shared inside the SSH server.
     * @param {string} image - The Docker image for the SSH server (default: 'lscr.io/linuxserver/openssh-server:9.3_p2-r0-ls132').
     * @param {number} insidePort - The port on which the SSH server will run inside the container (default: 2222).
     */
    constructor(sharedDirectory, image = 'lscr.io/linuxserver/openssh-server:9.3_p2-r0-ls132', insidePort = 2222) {
        this.sharedDirectory = sharedDirectory;
        this.image = image;
        this.insidePort = insidePort;

        this.containerPrefix = 'sshserver_';
        this.dockerSharedDirectory = '/shared';
        this.maxStartRetries = 3;
        this.startTimeout = 10000;
        this.maxStopRetries = 3;
        this.stopTimeout = 10000;
        this.reservePortTimeout = 30000;
        this.reservePortMaxTime = 3600000;

        this.username = this.generateRandomString();
        this.password = this.generateRandomString();
    }

    /**
     * Creates a new instance of SSHServer. Should only be used for retrieving existing SSHServers.
     * @param {string} containerId - The ID of the Container.
     * @param {number} reservedPort - The port reserved by the container.
     * @returns {SSHServer} A new instance of SSHServer representing the retrieved ssh server.
     */
    static getExistingSSHServer(containerId, reservedPort) {
        let sshServer = new SSHServer(undefined);
        sshServer.containerId = containerId;
        sshServer.reservedPort = reservedPort;
        return sshServer;
    }

    /**
     * Start an SSH server container.
     *
     * @throws {Error} if the server fails to start.
     */
    async startServer() {
        try {
            if (this.reservedPort == undefined) {
                throw new Error('Reserve a Port before starting the server!');
            }

            this.containerName = this.containerPrefix + this.reservedPort;
            let startCommand = 'docker run' +
                ' -p ' + this.reservedPort + ':' + this.insidePort +
                ' -v ' + this.sharedDirectory + ':' + this.dockerSharedDirectory +
                ' -e PUID=1000' +
                ' -e PGID=1000' +
                ' -e PASSWORD_ACCESS=true' +
                ' -e USER_NAME=' + this.username +
                ' -e USER_PASSWORD=' + this.password +
                ' -d' +
                ' --name ' + this.containerName +
                ' ' + this.image;

            let stdout = await this.runDockerCommand(startCommand, this.maxStartRetries, this.startTimeout);
            this.containerId = stdout.trim();
        } catch (error) {
            throw new Error('Failed to start server: ' + error.message);
        }
    }

    /**
     * Stop the SSH server container.
     *
     * @throws {Error} if the server fails to stop or remove.
     */
    async stopServer() {
        try {
            await this.runDockerCommand('docker stop ' + this.containerId, this.maxStopRetries, this.stopTimeout);
            await this.runDockerCommand('docker rm ' + this.containerId, this.maxStopRetries, this.stopTimeout);
            this.freePort();
        } catch (error) {
            throw new Error('Failed to remove server: ' + error.message);
        }
    }

    /**
     * Run a Docker command asynchronously with retries.
     *
     * @param {string} cmd - The Docker command to run.
     * @param {number} maxRetries - The maximum number of retries.
     * @param {number} timeout - The timeout duration between retries.
     * @returns {Promise} A promise that resolves when the command is successful.
     */
    async runDockerCommand(cmd, maxRetries, timeout) {
        return new Promise((resolve, reject) => {
            const { exec } = require('child_process');
            let retries = 0;
            let runner = function () {
                exec(cmd, (error, stdout) => {
                    if (error) {
                        if (retries++ < maxRetries) {
                            setTimeout(runner, timeout);
                            return;
                        }
                        reject(new Error(error));
                    }
                    resolve(stdout);
                })
            };
            runner.call(this);
        });
    }

    /**
     * Reserve a port from the available ports array.
     *
     * @returns {Promise} A promise that resolves with the reserved port or rejects if unsuccessful.
     */
    async reservePort() {
        this.reservedPort = await this.fetchAndWaitForPort();
        if (this.reservedPort == undefined) {
            throw new Error('Could not reserve port!');
        }
        return this.reservedPort;
    }

    /**
     * Fetch and wait for an available port.
     *
     * @returns {Promise} A promise that resolves with the reserved port or rejects if unsuccessful.
     */
    fetchAndWaitForPort() {
        return new Promise((resolve, reject) => {
            let retries = 0;
            let reservedPort = undefined;

            let runner = function () {
                reservedPort = SSHServer.availablePorts.shift();
                if (reservedPort !== undefined) {
                    resolve(reservedPort);
                    return;
                }
                if (retries++ > (this.reservePortMaxTime / this.reservePortTimeout)) {
                    reject();
                    return;
                }
                setTimeout(runner, this.reservePortTimeout)
            }
            runner.call(this);
        });
    }

    /**
     * Free the reserved port and return it to the available ports array.
     */
    freePort() {
        if (this.reservedPort) {
            SSHServer.availablePorts.push(this.reservedPort);
            this.reservePort = undefined;
        }
    }

    /**
     * Generate a random string of 16 hexadecimal characters.
     *
     * @returns {string} A random string.
     */
    generateRandomString() {
        var crypto = require("crypto");
        return crypto.randomBytes(8).toString('hex');
    }

    /**
     * Set the range of available ports for SSH server containers.
     *
     * @param {number} firstPort - The first port in the range.
     * @param {number} lastPort - The last port in the range.
     */
    static setPortRange(firstPort, lastPort) {
        if (firstPort > lastPort) {
            return
        }

        SSHServer.availablePorts = []
        for (let i = firstPort; i <= lastPort; i++) {
            SSHServer.availablePorts.push(i);
        }
    }

}

module.exports = {
    CCExperiment: CCExperiment,
    DefaultExperiment: DefaultExperiment,
    CCInput: CCInput,
    CCOutput: CCOutput,
    CCConnector: CCConnector,
    CCSSHConnector: CCSSHConnector,
    CCHTTPConnector: CCHTTPConnector,
    CCFTPConnector: CCFTPConnector,
    SSHServer: SSHServer
}
