# CC-API

This project contains files that are designed to interact with the Curious Containers platform for running experiments. The main purpose of the code is to create, configure, and start experiments using the Curious Containers API. It offers a JavaScript library (cc-api.js) that provides classes and methods to facilitate the process.

## Description and Structure

`CCExperiment`: This class represents a custom experiment and provides methods to configure and start the experiment. It allows users to define inputs, outputs, GPUs, and other experiment-related settings. The class also facilitates the creation of the RED JSON object, which is required to start the experiment on the Curious Containers platform.

`DefaultExperiment`: This class is a subclass of `CCExperiment` and extends its functionality by providing a simpler way to create experiments with predefined input and output configurations. It includes a method called `createDefaultIO()` that sets up default input and output connectors for the experiment. The default connectors are:
- SSH Input for the Script file, that will be executed
- SSH Input for the Dataset that will be used by the Script
- SSH Output that will return everything located inside the `./outputs` directory.

`CCInput`, `CCOutput`, `CCConnector`, `CCSSHConnector`, `CCHTTPConnector` and `CCFTPConnector `: These classes represent various components of an experiment, such as input parameters, output parameters, and connectors for different data sources (SSH, HTTP or FTP).

`SSHServer`: This class is used to manage Docker containers running OpenSSH servers. It allows the experiment to deploy SSH servers to transfer the input and output data between the container and the host system.

## How to use

`test-custom.js` and `test-default.js` provides examples on how to use the API. 

Usage of SSHServer:
```
SSHServer.setPortRange(firstPort, lastPort);

let sshServer = new SSHServer(sharedDirectory);
let sshPort = await sshServer.reservePort();

let experiment = new CCExperiment();
experiment.setSSHServer(sshServer);
```