const core = require("@actions/core");
const exec = require("@actions/exec"); 
const github = require("@actions/github");

const validateBranchName = ({ branchName }) => /^[a-zA-Z0-9_\-\.\/]+$/.test(branchName);
const validateDirectoryName = ({ dirName }) => /^[a-zA-Z0-9_\-\/]+$/.test(dirName);
const setupLogger = ({ debug, prefix } = { debug: false, prefix: '' }) => ({
    debug: (message) => {
        if (debug) {
            core.info(`DEBUG ${prefix}${prefix ? ' : ' : ''}${message}`);
        }
    },
    info: (message) => {
        core.info(`INFO ${prefix}${prefix ? ' : ' : ''}${message}`);
    },
    warn: (message) => {
        core.error(`${prefix}${prefix ? ' : ' : ''}${message}`);
    },
});

async function run() {
    const baseBranch = core.getInput('base-branch', { required: true });
    const targetBranch = core.getInput('target-branch', { required: true });
    const ghToken = core.getInput('gh-token', { required: true });
    const workingDir = core.getInput('working-directory', { required: true });
    const debug = core.getInput('debug');
    const logger = setupLogger({ debug, prefix: '[js-dependency-update]' });

    const commonExecOpts = {
        cwd: workingDir,
    };
    core.setSecret(ghToken);

    logger.debug('Validating inputs base-branch, target-branch, working-directory');

    if (!validateBranchName({ branchName: baseBranch })) {
        core.setFailed("Invalid base branch name");
        return;
    }

    if (!validateBranchName({ branchName: targetBranch })) {
        core.setFailed("Invalid target-branch name");
        return;
    }   

    if (!validateDirectoryName({ dirName: workingDir })) {
        core.setFailed("Invalid working directory name");
        return;
    }   

    logger.debug(`base branch is ${baseBranch}`);
    logger.debug(`target branch is ${targetBranch}`);
    logger.debug(`working directory is ${workingDir}`);

    await exec.exec('npm update', [], {
        ...commonExecOpts
    });

    const gitStatus = await exec.getExecOutput('git status -s package.json', [], {
        cwd: workingDir
    });

    let updatesAvailable = false;

    if (gitStatus.stdout.length > 0) {
        updatesAvailable = true;

        logger.debug('There are updates available!');
        logger.debug('Setup git credentials!');

        await exec.exec(`git config --global user.name "daniel-marius"`);
        await exec.exec(`git config --global user.email "danieladam01995@gmail.com"`);
        await exec.exec(`git checkout -b ${targetBranch}`, [], {
            ...commonExecOpts,
        });
        await exec.exec(`git add package.json package-lock.json`, [], {
            ...commonExecOpts,
        });
        await exec.exec(`git commit -m "chore: update dependencies"`, [], {
            ...commonExecOpts,
        });
        await exec.exec(`git push -u origin ${targetBranch} --force`, [], {
            ...commonExecOpts,
        });

        logger.debug('Fetch Octokit API!');
        const octokit = github.getOctokit(ghToken);

        try {
            logger.debug(`Creating a PR using target branch: ${targetBranch}`);
            await octokit.rest.pulls.create({
                owner: github.context.repo.owner,
                repo: github.context.repo.repo,
                title: 'Update NPM dependencies',
                body: 'This pull request updates NPM packages',
                base: baseBranch,
                head: targetBranch,
            });
        } catch (e) {
            logger.error('Something went wrong while creating the PR. Check logs below.');
            core.setFailed(e.message);
            core.warning(e);
        }
    } else {
        logger.info('No updates at this point in time');
    }

    /*
    1. Parse inputs: 
        1.1 base-branch from which to check for updates
        1.2 target-branch to use to create the PR
        1.3 GitHub Token for authentication purposes
        1.4 Working directory for which to check dependencies
    2. Execute npm update command within working directory
    3. Check wheter there are modified package*.json files
    4. If there are modified files:
        4.1 Add and commit files to the target-branch
        4.2 Create a PR to the base-branch using octokit API (GitHub API)
    5 Otherwise, conclude the custom action
    */ 
    logger.debug(`Setting updates-available output to ${updatesAvailable}`);
    core.setOutput('updates-available', updatesAvailable);
}

run();