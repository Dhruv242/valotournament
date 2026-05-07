#!/bin/bash

echo "╔════════════════════════════════════════════════════════╗"
echo "║  Valorant Tournament Platform - Deployment Checker    ║"
echo "║  Verifying 8-team tournaments with Quarterfinals      ║"
echo "╚════════════════════════════════════════════════════════╝"
echo ""

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

ERRORS=0
WARNINGS=0

# Change to project directory
cd "/Users/dhruvks-echo/Documents/New project/Valorant"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "1. CHECKING BACKEND FILES"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check payment.js
echo -n "✓ Checking payment.js... "
if [ -f "Backend/routes/payment.js" ]; then
    # Check if it has 8-team logic
    if grep -q "max_teams, 8" Backend/routes/payment.js; then
        echo -e "${GREEN}✓ Updated (8-team tournaments)${NC}"
    else
        echo -e "${RED}✗ OLD VERSION (still has 6-team logic)${NC}"
        ERRORS=$((ERRORS + 1))
    fi
else
    echo -e "${RED}✗ Missing${NC}"
    ERRORS=$((ERRORS + 1))
fi

# Check tournament.js
echo -n "✓ Checking tournament.js... "
if [ -f "Backend/routes/tournament.js" ]; then
    # Check if it has authorization logic
    if grep -q "decoded.role !== 'admin' && decoded.email !== team.owner_email" Backend/routes/tournament.js; then
        echo -e "${GREEN}✓ Updated (with player authorization)${NC}"
    else
        echo -e "${RED}✗ OLD VERSION (no authorization)${NC}"
        ERRORS=$((ERRORS + 1))
    fi
else
    echo -e "${RED}✗ Missing${NC}"
    ERRORS=$((ERRORS + 1))
fi

# Check admin.js
echo -n "✓ Checking admin.js... "
if [ -f "Backend/routes/admin.js" ]; then
    # Check if it uses 'round' instead of 'bracket_round'
    if grep -q "m.round ASC" Backend/routes/admin.js && ! grep -q "bracket_round" Backend/routes/admin.js; then
        echo -e "${GREEN}✓ Updated (fixed bracket_round error)${NC}"
    else
        echo -e "${RED}✗ OLD VERSION (still has bracket_round)${NC}"
        ERRORS=$((ERRORS + 1))
    fi
else
    echo -e "${RED}✗ Missing${NC}"
    ERRORS=$((ERRORS + 1))
fi

# Check auth.js
echo -n "✓ Checking auth.js... "
if [ -f "Backend/routes/auth.js" ]; then
    # Check if it has password validation
    if grep -q "Invalid password" Backend/routes/auth.js; then
        echo -e "${GREEN}✓ Updated (password validation fixed)${NC}"
    else
        echo -e "${YELLOW}⚠ Check manually for password validation${NC}"
        WARNINGS=$((WARNINGS + 1))
    fi
else
    echo -e "${RED}✗ Missing${NC}"
    ERRORS=$((ERRORS + 1))
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "2. CHECKING FRONTEND FILES"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check app.js
echo -n "✓ Checking app.js... "
if [ -f "Frontend/app.js" ]; then
    if grep -q "loadAdminDashboard" Frontend/app.js; then
        echo -e "${GREEN}✓ Updated (has admin dashboard functions)${NC}"
    else
        echo -e "${RED}✗ OLD VERSION (no admin dashboard)${NC}"
        ERRORS=$((ERRORS + 1))
    fi
else
    echo -e "${RED}✗ Missing${NC}"
    ERRORS=$((ERRORS + 1))
fi

# Check index.html
echo -n "✓ Checking index.html... "
if [ -f "Frontend/index.html" ]; then
    if grep -q 'data-nav="admin"' Frontend/index.html; then
        echo -e "${GREEN}✓ Has admin nav link${NC}"
    else
        echo -e "${RED}✗ Missing admin nav link${NC}"
        ERRORS=$((ERRORS + 1))
    fi
    
    if grep -q 'id="admin"' Frontend/index.html; then
        echo -e "${GREEN}✓ Has admin section${NC}"
    else
        echo -e "${RED}✗ Missing admin section${NC}"
        ERRORS=$((ERRORS + 1))
    fi
    
    # Check for 8 teams text
    if grep -q "8 teams" Frontend/index.html; then
        echo -e "${GREEN}✓ Updated to 8 teams${NC}"
    else
        echo -e "${YELLOW}⚠ Still shows 6 teams (update manually)${NC}"
        WARNINGS=$((WARNINGS + 1))
    fi
else
    echo -e "${RED}✗ Missing${NC}"
    ERRORS=$((ERRORS + 1))
fi

# Check styles.css
echo -n "✓ Checking styles.css... "
if [ -f "Frontend/styles.css" ]; then
    if grep -q "admin-layout" Frontend/styles.css; then
        echo -e "${GREEN}✓ Has admin styles${NC}"
    else
        echo -e "${YELLOW}⚠ Missing admin styles${NC}"
        WARNINGS=$((WARNINGS + 1))
    fi
else
    echo -e "${RED}✗ Missing${NC}"
    ERRORS=$((ERRORS + 1))
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "3. CHECKING DATABASE SCHEMA"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo "Please run this command to check your database:"
echo ""
echo "kubectl exec -it <POSTGRES_POD_NAME> -- psql -U youruser -d valorant << 'DBCHECK'"
echo "SELECT column_name FROM information_schema.columns WHERE table_name = 'matches' AND column_name IN ('round', 'position');"
echo "SELECT column_name FROM information_schema.columns WHERE table_name = 'tournaments' AND column_name = 'max_teams';"
echo "SELECT max_teams FROM tournaments LIMIT 1;"
echo "DBCHECK"
echo ""
echo "Expected output:"
echo "  - matches table should have 'round' and 'position' columns"
echo "  - tournaments table should have 'max_teams' column"
echo "  - max_teams should be 8 (not 6)"
echo ""
read -p "Have you verified the database? (y/n): " db_verified

if [ "$db_verified" = "y" ] || [ "$db_verified" = "Y" ]; then
    echo -e "${GREEN}✓ Database verified${NC}"
else
    echo -e "${YELLOW}⚠ Database not verified yet${NC}"
    WARNINGS=$((WARNINGS + 1))
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "4. SUMMARY"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
    echo -e "${GREEN}✓✓✓ ALL CHECKS PASSED! ✓✓✓${NC}"
    echo ""
    echo "Your system is up to date and ready to run!"
    echo ""
    echo "Start the backend with:"
    echo "  cd Backend && npm start"
    echo ""
    echo "Start the frontend with:"
    echo "  cd Frontend && python3 -m http.server 4173"
    echo ""
    echo "Admin login:"
    echo "  Email: dhruvdk1234@gmail.com"
    echo "  Password: admin123"
elif [ $ERRORS -eq 0 ]; then
    echo -e "${YELLOW}⚠ $WARNINGS WARNING(S)${NC}"
    echo ""
    echo "System should work, but review warnings above."
else
    echo -e "${RED}✗ $ERRORS ERROR(S) FOUND${NC}"
    if [ $WARNINGS -gt 0 ]; then
        echo -e "${YELLOW}⚠ $WARNINGS WARNING(S)${NC}"
    fi
    echo ""
    echo "Please fix the errors above before running!"
    echo ""
    echo "Quick fixes:"
    echo "1. Download missing files from Claude"
    echo "2. Copy them to the correct locations"
    echo "3. Apply database schema if not done yet"
    echo "4. Run this script again"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
