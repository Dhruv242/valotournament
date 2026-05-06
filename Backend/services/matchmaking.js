function generateMatches(teams) {
    teams = [...teams].sort(() => Math.random() - 0.5);
  
    const totalTeams = teams.length;
    const nextPower = Math.pow(2, Math.ceil(Math.log2(totalTeams)));
    const byes = nextPower - totalTeams;
  
    let matches = [];
    let index = 0;
  
    while (index < teams.length - byes) {
      matches.push({
        team1: teams[index],
        team2: teams[index + 1],
      });
      index += 2;
    }
  
    for (let i = 0; i < byes; i++) {
      matches.push({
        team1: teams[teams.length - 1 - i],
        team2: null,
        bye: true,
      });
    }
  
    return matches;
  }
  
  module.exports = { generateMatches };