package main

import "fmt"

// cloudAccountProviderConnector tests onboarded cloud account credentials on the server.
// Azure and GCP are catalog-ready stubs until their adapters are implemented.
type cloudAccountProviderConnector interface {
	TestConnection(item *cloudAccountRecord, creds *cloudAccountCredentials) error
}

func cloudConnectorForProvider(provider string) cloudAccountProviderConnector {
	switch normalizeCloudProvider(provider) {
	case "aws":
		return awsCloudAccountConnector{}
	case "azure", "gcp":
		return stubCloudAccountConnector{provider: normalizeCloudProvider(provider)}
	default:
		return awsCloudAccountConnector{}
	}
}

type awsCloudAccountConnector struct{}

func (awsCloudAccountConnector) TestConnection(item *cloudAccountRecord, creds *cloudAccountCredentials) error {
	return testAWSCloudAccount(item, creds)
}

type stubCloudAccountConnector struct {
	provider string
}

func (s stubCloudAccountConnector) TestConnection(item *cloudAccountRecord, creds *cloudAccountCredentials) error {
	_ = item
	_ = creds
	return fmt.Errorf("%s onboarding is catalog-ready; connection test is not implemented yet", s.provider)
}
