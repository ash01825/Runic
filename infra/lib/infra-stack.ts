import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw from 'aws-cdk-lib/aws-apigateway'; // Added for API Gateway
import * as path from 'path';

export class InfraStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        // S3 bucket for storing artifacts
        const artifactBucket = new s3.Bucket(this, 'OpsFlowArtifactBucket', {
            // Using a dynamic name to ensure global uniqueness. CDK will generate a unique name.
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
            versioned: true,
        });

        // DynamoDB table for storing incident metadata
        const incidentTable = new dynamodb.Table(this, 'OpsFlowIncidents', {
            tableName: 'OpsFlowIncidents',
            partitionKey: { name: 'incidentId', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });

        // SNS topic for incident alerts or notifications
        const alertTopic = new sns.Topic(this, 'OpsFlowAlertTopic', {
            topicName: 'opsflow-alerts',
            displayName: 'OpsFlow Alerts Topic',
        });

        // SQS queue to buffer incoming incidents (Step 3)
        const opsQueue = new sqs.Queue(this, 'OpsFlowQueue', {
            queueName: 'opsflow-queue',
            visibilityTimeout: cdk.Duration.seconds(300),
            retentionPeriod: cdk.Duration.days(4),
        });

        // Lambda function to normalize incoming alert data before pushing to SQS
        const alertNormalizerLambda = new NodejsFunction(this, 'AlertNormalizerFunction', {
            functionName: 'opsflow-alert-normalizer',
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'handler',
            entry: path.join(__dirname, '../../lambdas/alert_normalizer/index.js'),
            // Note: projectRoot and depsLockFilePath are often not needed with recent NodejsFunction constructs
            // but are kept here as they were in the original file.
            projectRoot: path.join(__dirname, '../../'),
            depsLockFilePath: path.join(__dirname, '../../package-lock.json'),
            bundling: {
                // aws-sdk is included in the Lambda runtime, no need to bundle.
            },
            environment: {
                QUEUE_URL: opsQueue.queueUrl,
            },
            timeout: cdk.Duration.seconds(10),
        });

        // Allow the Lambda to send messages to the queue
        opsQueue.grantSendMessages(alertNormalizerLambda);

        // API Gateway to receive webhooks and trigger the Lambda (Step 2)
        const api = new apigw.LambdaRestApi(this, 'OpsFlowAlertApi', {
            handler: alertNormalizerLambda,
            proxy: false, // We define the specific integration
            description: 'API endpoint for ingesting alerts from synthetic generator'
        });

        // Create a resource and method for the API (e.g., POST /alerts)
        const alerts = api.root.addResource('alerts');
        alerts.addMethod('POST'); // This integrates the POST /alerts request with our Lambda

        // Outputs for visibility in CloudFormation/console
        new cdk.CfnOutput(this, 'S3BucketName', { value: artifactBucket.bucketName });
        new cdk.CfnOutput(this, 'DynamoTableName', { value: incidentTable.tableName });
        new cdk.CfnOutput(this, 'SnsTopicArn', { value: alertTopic.topicArn });
        new cdk.CfnOutput(this, 'SqsQueueUrl', { value: opsQueue.queueUrl });
        new cdk.CfnOutput(this, 'LambdaFunctionName', { value: alertNormalizerLambda.functionName });
        new cdk.CfnOutput(this, 'ApiGatewayUrl', {
            value: api.url,
            description: 'The base URL of the API Gateway. Use this URL + /alerts in your script.'
        });
    }
}
