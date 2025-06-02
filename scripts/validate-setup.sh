#!/bin/bash

# Multi-Agent System - Setup Validation Script
# This script validates that all required files exist for deployment

set -e

echo "🔍 Validating Multi-Agent System Setup..."
echo "==========================================="

# Check for root package.json
if [ -f "package.json" ]; then
    echo "✅ Root package.json found"
else
    echo "❌ Root package.json missing"
    exit 1
fi

# Check for CloudFormation template
if [ -f "infra/cloudformation/ecs-infrastructure.yml" ]; then
    echo "✅ CloudFormation template found"
else
    echo "❌ CloudFormation template missing"
    exit 1
fi

# Check for GitHub Actions workflow
if [ -f ".github/workflows/deploy-ecs.yml" ]; then
    echo "✅ GitHub Actions workflow found"
else
    echo "❌ GitHub Actions workflow missing"
    exit 1
fi

# Check for Dockerfiles
echo ""
echo "📦 Checking Dockerfiles..."
services=("task-router" "agent-web")
agents=("researcher" "product_manager" "drawer" "designer" "coder")

for service in "${services[@]}"; do
    if [ -f "$service/Dockerfile" ]; then
        echo "✅ $service/Dockerfile found"
    else
        echo "❌ $service/Dockerfile missing"
        exit 1
    fi
done

for agent in "${agents[@]}"; do
    if [ -f "agents/$agent/Dockerfile" ]; then
        echo "✅ agents/$agent/Dockerfile found"
    else
        echo "❌ agents/$agent/Dockerfile missing"
        exit 1
    fi
done

# Check for package.json files
echo ""
echo "📋 Checking package.json files..."

for service in "${services[@]}"; do
    if [ -f "$service/package.json" ]; then
        echo "✅ $service/package.json found"
    else
        echo "❌ $service/package.json missing"
        exit 1
    fi
done

for agent in "${agents[@]}"; do
    if [ -f "agents/$agent/package.json" ]; then
        echo "✅ agents/$agent/package.json found"
    else
        echo "❌ agents/$agent/package.json missing"
        exit 1
    fi
done

# Validate CloudFormation template
echo ""
echo "🔧 Validating CloudFormation template..."
if command -v aws &> /dev/null; then
    if aws cloudformation validate-template --template-body file://infra/cloudformation/ecs-infrastructure.yml > /dev/null 2>&1; then
        echo "✅ CloudFormation template is valid"
    else
        echo "❌ CloudFormation template validation failed"
        echo "Run: aws cloudformation validate-template --template-body file://infra/cloudformation/ecs-infrastructure.yml"
        exit 1
    fi
else
    echo "⚠️  AWS CLI not found - skipping CloudFormation validation"
fi

# Check if required GitHub secrets are documented
echo ""
echo "🔐 Required GitHub Secrets:"
echo "   - AWS_ACCESS_KEY_ID"
echo "   - AWS_SECRET_ACCESS_KEY" 
echo "   - AWS_ACCOUNT_ID"
echo "   - OPENAI_API_KEY"
echo ""
echo "ℹ️  Configure these in GitHub: Settings > Secrets and variables > Actions"

echo ""
echo "🎉 Setup validation completed successfully!"
echo ""
echo "Next steps:"
echo "1. Configure GitHub secrets (see above)"
echo "2. Push to 'develop' branch for staging deployment"
echo "3. Push to 'main' branch for production deployment"
echo "4. Or use manual workflow dispatch from GitHub Actions"
echo ""
echo "📖 See DEPLOYMENT.md for detailed instructions" 