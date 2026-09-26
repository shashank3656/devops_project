package main

// cloudAccountProviderConnector tests onboarded cloud account credentials on the server.
// Azure and GCP are catalog-ready stubs until their adapters are implemented.
type cloudAccountProviderConnector interface {
	TestConnection(item *cloudAccountRecord, creds *cloudAccountCredentials) error
}

func cloudConnectorForProvider(provider string) cloudAccountProviderConnector {
	switch normalizeCloudProvider(provider) {
	case "aws":
		return awsCloudAccountConnector{}
	case "azure":
		return azureCloudAccountConnector{}
	case "gcp":
		return gcpCloudAccountConnector{}
	default:
		return awsCloudAccountConnector{}
	}
}

type awsCloudAccountConnector struct{}

func (awsCloudAccountConnector) TestConnection(item *cloudAccountRecord, creds *cloudAccountCredentials) error {
	return testAWSCloudAccount(item, creds)
}

type azureCloudAccountConnector struct{}

func (azureCloudAccountConnector) TestConnection(item *cloudAccountRecord, creds *cloudAccountCredentials) error {
	return testAzureCloudAccount(item, creds)
}

type gcpCloudAccountConnector struct{}

func (gcpCloudAccountConnector) TestConnection(item *cloudAccountRecord, creds *cloudAccountCredentials) error {
	return testGCPCloudAccount(item, creds)
}
