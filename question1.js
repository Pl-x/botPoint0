let fizz = []
let Buzz = []
let fizzBuzz = []
const polo = document.getElementById('polo')
console.log(polo)

for (let num = 0;num <= 100;num++)
{
 if(((num%3) == 0) && ((num%5)==0))
  {
    
    console.log(num,"FizzBuzz")
    fizzBuzz.push(num)
    
  }
  else if((num%3) == 0)
  {
    console.log(num,"fizz")
    fizz.push(num)
    
    
  }   
  else if((num%5)==0)
  {
    console.log(num,"Buzz")
    Buzz.push(num)
    
  }
  
}
let new_content = 
(
    `<h3>Multiples of 3 and 5</h3>
    <ul>${fizzBuzz.map(num => `<li>${num+ ",fizzBuzz"}</li>`)}
    <h3>Multiples of 3</h3>
    <ul>${fizz.map(num => `<li>${num+ ",fizz"}</li>`)}
    <br></br>
    <h3>Multiples of 5</h3>
    <ul>${Buzz.map(num => `<li>${num+ ",Buzz"}</li>`)}    
    `
)
polo.innerHTML = new_content
