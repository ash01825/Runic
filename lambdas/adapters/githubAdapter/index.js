import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { Octokit } from "@octokit/rest";

// Cache secrets and clients outside the handler
let octokit;
let githubToken;
const secretsClient = new SecretsManagerClient({});

/**
 * Fetches the GitHub token from AWS Secrets Manager.
 * Caches the token for subsequent invocations.
 */
async function getGitHubToken() {
    if (githubToken) return githubToken;

    const secretArn = process.env.GITHUB_SECRET_ARN;
    if (!secretArn) {
        throw new Error('GITHUB_SECRET_ARN environment variable is not set.');
    }

    console.log('Fetching GitHub secret from Secrets Manager...');
    const command = new GetSecretValueCommand({ SecretId: secretArn });
    const data = await secretsClient.send(command);

    if (data.SecretString) {
        const secret = JSON.parse(data.SecretString);
        githubToken = secret.GITHUB_TOKEN;
        return githubToken;
    } else {
        throw new Error('SecretString not found in secret.');
    }
}

/**
 * Initializes the Octokit client.
 */
async function getOctokit() {
    if (octokit) return octokit;
    const token = await getGitHubToken();
    console.log('Initializing Octokit client.');
    octokit = new Octokit({ auth: token });
    return octokit;
}

/**
 * Main Lambda Handler
 */
export const handler = async (event) => {
    console.log("GitHub Adapter invoked:", JSON.stringify(event, null, 2));

    const { incidentId, planStep } = event;
    const { stepId, action, params } = planStep;

    if (!incidentId || !planStep) {
        throw new Error("Invalid input: 'incidentId' and 'planStep' are required.");
    }

    try {
        const client = await getOctokit();
        let result;

        // This router allows us to add more GitHub actions later
        switch (action) {
            case 'dispatch_rollback_workflow':
                result = await dispatchWorkflow(client, params);
                break;

            default:
                throw new Error(`Unsupported action: ${action}`);
        }

        // Return the standard success payload
        return {
            status: 'success',
            incidentId: incidentId,
            stepId: stepId,
            output: {
                message: `Action '${action}' completed successfully.`,
                details: result,
            },
        };

    } catch (error) {
        console.error(`Error in step ${stepId} for incident ${incidentId}:`, error);
        // Re-throw the error so the Step Function can catch it
        throw new Error(`Action '${action}' failed: ${error.message}`);
    }
};

/**
 * Triggers a GitHub Actions workflow dispatch.
 */
async function dispatchWorkflow(client, params) {
    const { owner, repo, workflow_id, ref, inputs } = params;

    if (!owner || !repo || !workflow_id || !ref) {
        throw new Error("dispatch_rollback_workflow requires 'owner', 'repo', 'workflow_id', and 'ref' parameters.");
    }

    console.log(`Dispatching workflow '${workflow_id}' on ${owner}/${repo}@${ref}...`);

    const response = await client.actions.createWorkflowDispatch({
        owner,
        repo,
        workflow_id,
        ref,
        inputs: inputs || {}, // Pass inputs if they exist
    });

    return {
        httpStatus: response.status, // Should be 204
        message: `Workflow dispatch request sent.`,
    };
}