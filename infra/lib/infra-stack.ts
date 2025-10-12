import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';

export class InfraStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        // 🚀 S3 Bucket for artifacts
        const artifactBucket = new s3.Bucket(this, 'OpsFlowArtifactBucket', {
            bucketName: 'opsflow-artifacts',
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            autoDeleteObjects: true, // Note: only works with appropriate CDK context flag
            versioned: true,
        });

        // 📄 DynamoDB Table for incident metadata
        const incidentTable = new dynamodb.Table(this, 'OpsFlowIncidents', {
            tableName: 'OpsFlowIncidents',
            partitionKey: { name: 'incidentId', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });

        // 🔔 SNS Topic for alerting or notifications
        const alertTopic = new sns.Topic(this, 'OpsFlowAlertTopic', {
            topicName: 'opsflow-alerts',
            displayName: 'OpsFlow Alerts Topic',
        });

        // 📬 SQS Queue for incoming incident pipeline
        const opsQueue = new sqs.Queue(this, 'OpsFlowQueue', {
            queueName: 'opsflow-queue',
            visibilityTimeout: cdk.Duration.seconds(300),
            retentionPeriod: cdk.Duration.days(4),
        });

        // 👇 Optional: Output names for debugging or reference
        new cdk.CfnOutput(this, 'S3BucketName', {
            value: artifactBucket.bucketName,
        });

        new cdk.CfnOutput(this, 'DynamoTableName', {
            value: incidentTable.tableName,
        });

        new cdk.CfnOutput(this, 'SnsTopicArn', {
            value: alertTopic.topicArn,
        });

        new cdk.CfnOutput(this, 'SqsQueueUrl', {
            value: opsQueue.queueUrl,
        });
    }
}
